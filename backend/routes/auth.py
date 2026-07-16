from datetime import datetime, timedelta, timezone
from typing import Optional
import httpx
from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from pydantic import BaseModel
from bson import ObjectId

from config import settings
from db.mongo import MongoDB

router = APIRouter(prefix="/api/auth", tags=["auth"])
security = HTTPBearer()

class GoogleLoginRequest(BaseModel):
    idToken: str

class TokenResponse(BaseModel):
    token: str
    user: dict

class OAuthExchangeRequest(BaseModel):
    code: str
    redirect_uri: str

class OAuthRefreshRequest(BaseModel):
    refresh_token: str

class OAuthRevokeRequest(BaseModel):
    refresh_token: str

def create_jwt_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRY_MINUTES)
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)

_cached_public_key = None
_cached_key_expiry = None

async def decode_iam_token(token: str) -> dict:
    """
    Decodes and verifies an RS256 JWT using Lixionary IAM's JWKS endpoint.
    """
    global _cached_public_key, _cached_key_expiry
    
    if settings.DEV_MODE:
        try:
            # Check if token is locally signed (HS256 mock/guest token)
            unverified = jwt.decode(token, options={"verify_signature": False})
            sub = unverified.get("sub", "")
            if sub.startswith("google-") or sub.startswith("sess_") or "@" in sub or sub == "google-guest-999":
                return jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
        except Exception:
            pass

    try:
        now = datetime.now(timezone.utc)
        if _cached_public_key is None or _cached_key_expiry is None or now > _cached_key_expiry:
            async with httpx.AsyncClient() as client:
                res = await client.get(f"{settings.IAM_URL}/oauth/jwks")
                if res.status_code == 200:
                    jwks = res.json()
                    if jwks.get("keys"):
                        from jwt import PyJWK
                        # Fallback: if JWT has no kid or kid is not in JWKS, use the first key in the set
                        header = jwt.get_unverified_header(token)
                        kid = header.get("kid")
                        
                        target_key = None
                        if kid:
                            for key in jwks["keys"]:
                                if key.get("kid") == kid:
                                    target_key = key
                                    break
                        
                        if not target_key:
                            target_key = jwks["keys"][0]
                            
                        jwk = PyJWK(target_key)
                        _cached_public_key = jwk.key
                        _cached_key_expiry = now + timedelta(hours=1)
                else:
                    print(f"Failed to fetch JWKS from IAM (Status {res.status_code})")
        
        if _cached_public_key is None:
            raise Exception("No public key resolved from JWKS")
            
        payload = jwt.decode(
            token,
            _cached_public_key,
            algorithms=["RS256"],
            options={"verify_aud": False}
        )
        return payload
    except Exception as e:
        print(f"IAM JWT verification failed: {e}")
        if settings.DEV_MODE:
            try:
                return jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
            except Exception:
                pass
        raise HTTPException(status_code=401, detail="Invalid token signature")

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """
    FastAPI dependency to secure routes and retrieve the logged-in user.
    Supports local HS256 tokens and RS256 tokens from Lixionary IAM.
    """
    token = credentials.credentials
    try:
        payload = await decode_iam_token(token)
        
        email = payload.get("email")
        if not email:
            raise HTTPException(status_code=401, detail="Token is missing email claim")

        users_col = MongoDB.get_collection("users")
        
        # Check if user exists by email, and sync user role/name from token claims
        user = await users_col.find_one({"email": email})
        
        if not user:
            # Check if this is the first user in the database
            is_db_empty = await users_col.count_documents({}) == 0
            user = {
                "googleId": payload.get("sub", ""),
                "email": email,
                "name": payload.get("name", email.split("@")[0].capitalize()),
                "avatarUrl": "",
                "role": "admin" if is_db_empty else "member",
                "disabled": False,
                "createdAt": datetime.now(timezone.utc),
                "updatedAt": datetime.now(timezone.utc)
            }
            res = await users_col.insert_one(user)
            user["_id"] = res.inserted_id
        else:
            # Sync name if changed (do NOT sync roles — local database is the source of truth for roles)
            updates = {}
            if payload.get("name") and user.get("name") != payload.get("name"):
                updates["name"] = payload.get("name")
                
            if updates:
                updates["updatedAt"] = datetime.now(timezone.utc)
                await users_col.update_one({"_id": user["_id"]}, {"$set": updates})
                user.update(updates)

        if user.get("disabled", False):
            raise HTTPException(status_code=403, detail="User account is disabled")
            
        user["id"] = str(user["_id"])
        return user
    except HTTPException:
        raise
    except Exception as e:
        print(f"Auth validation error: {e}")
        raise HTTPException(status_code=401, detail="Could not validate credentials")

async def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """
    FastAPI dependency to restrict routes to admin users only.
    """
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return current_user


async def _issue_session_for_google_user(google_id: str, email: str, name: str, avatar_url: str) -> dict:
    """
    Finds or creates the local user record for a verified Google identity and
    issues a local JWT session token. Shared by both the direct ID-token
    login (browser GIS) and the authorization-code exchange (desktop relay).
    """
    users_col = MongoDB.get_collection("users")
    is_db_empty = await users_col.count_documents({}) == 0
    user = await users_col.find_one({"googleId": google_id})

    if not user:
        new_user = {
            "googleId": google_id,
            "email": email,
            "name": name,
            "avatarUrl": avatar_url,
            "role": "admin" if is_db_empty else "member",
            "disabled": False,
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc)
        }
        res = await users_col.insert_one(new_user)
        user_id = str(res.inserted_id)
        user = new_user
    else:
        user_id = str(user["_id"])

    if user.get("disabled", False):
        raise HTTPException(status_code=403, detail="User account is disabled")

    jwt_token = create_jwt_token(user_id, email)

    return {
        "token": jwt_token,
        "user": {
            "id": user_id,
            "email": email,
            "name": name,
            "avatarUrl": avatar_url,
            "role": user.get("role", "member"),
            "disabled": user.get("disabled", False)
        }
    }

@router.post("/google", response_model=TokenResponse)
async def google_login(payload: GoogleLoginRequest):
    """
    Exchanges a Google OAuth ID token for a local JWT session token.
    In DEV_MODE, bypasses signature checks for mock development.
    """
    email = "developer@lixionary.com"
    name = "Developer User"
    google_id = "google-dev-12345"
    avatar_url = ""

    # Real verification if Client ID is configured and not in dev mode bypass
    if settings.GOOGLE_CLIENT_ID and not settings.DEV_MODE:
        try:
            from google.oauth2 import id_token
            from google.auth.transport import requests
            idinfo = id_token.verify_oauth2_token(payload.idToken, requests.Request(), settings.GOOGLE_CLIENT_ID)
            google_id = idinfo['sub']
            email = idinfo.get('email', '')
            name = idinfo.get('name', 'Google User')
            avatar_url = idinfo.get('picture', '')
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Google SSO validation failed: {str(e)}")
    else:
        # Debug/Dev mode mock verification
        # Parse email or info from mock ID token if provided
        if payload.idToken != "mock-token" and "@" in payload.idToken:
            email = payload.idToken
            name = email.split("@")[0].capitalize()

    return await _issue_session_for_google_user(google_id, email, name, avatar_url)

@router.post("/google/exchange", response_model=TokenResponse)
async def google_oauth_exchange(payload: OAuthExchangeRequest):
    """
    Exchanges a Google OAuth authorization code (from the redirect-based
    consent flow used by both the browser tab and the desktop system-browser
    relay) for tokens, verifies the resulting ID token, and issues a local
    JWT session — the direct-Google-SSO replacement for the old
    Lixionary-IAM-mediated /oauth-token flow.
    """
    async with httpx.AsyncClient() as client:
        try:
            res = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "grant_type": "authorization_code",
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "code": payload.code,
                    "redirect_uri": payload.redirect_uri,
                },
            )
            if res.status_code != 200:
                try:
                    err_data = res.json()
                    detail = err_data.get("error", "Failed to exchange authorization code")
                    if "error_description" in err_data:
                        detail += f": {err_data['error_description']}"
                except Exception:
                    detail = f"Failed to exchange authorization code (Status: {res.status_code}): {res.text[:200]}"
                raise HTTPException(status_code=res.status_code, detail=detail)

            tokens = res.json()
            id_token_str = tokens.get("id_token")
            if not id_token_str:
                raise HTTPException(status_code=400, detail="Google token response is missing an ID token")

            from google.oauth2 import id_token as google_id_token
            from google.auth.transport import requests as google_requests
            idinfo = google_id_token.verify_oauth2_token(id_token_str, google_requests.Request(), settings.GOOGLE_CLIENT_ID)

            email = idinfo.get("email", "")
            if not email:
                raise HTTPException(status_code=400, detail="Google ID token is missing an email claim")

            return await _issue_session_for_google_user(
                idinfo["sub"], email, idinfo.get("name", email.split("@")[0].capitalize()), idinfo.get("picture", "")
            )
        except httpx.RequestError as exc:
            raise HTTPException(status_code=503, detail=f"Google OAuth connection error: {exc}")

@router.post("/guest", response_model=TokenResponse)
async def guest_login():
    """
    Generates a Guest developer token for immediate local testing (Developer Mode).
    """
    google_id = "google-guest-999"
    email = "guest@lixionary.com"
    name = "Guest Developer"
    
    users_col = MongoDB.get_collection("users")
    is_db_empty = await users_col.count_documents({}) == 0
    user = await users_col.find_one({"googleId": google_id})

    if not user:
        new_user = {
            "googleId": google_id,
            "email": email,
            "name": name,
            "avatarUrl": "",
            "role": "admin" if is_db_empty else "member",
            "disabled": False,
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc)
        }
        res = await users_col.insert_one(new_user)
        user_id = str(res.inserted_id)
        user = new_user
    else:
        user_id = str(user["_id"])

    # Double-check that we do not let a disabled user login
    if user.get("disabled", False):
        raise HTTPException(status_code=403, detail="User account is disabled")

    jwt_token = create_jwt_token(user_id, email)
    
    return {
        "token": jwt_token,
        "user": {
            "id": user_id,
            "email": email,
            "name": name,
            "avatarUrl": "",
            "role": user.get("role", "member"),
            "disabled": user.get("disabled", False)
        }
    }

@router.post("/oauth-token")
async def oauth_token_exchange(payload: OAuthExchangeRequest):
    """
    Exchanges OAuth auth code for tokens by calling the IAM token endpoint.
    """
    async with httpx.AsyncClient() as client:
        try:
            req_body = {
                "grant_type": "authorization_code",
                "client_id": settings.IAM_CLIENT_ID,
                "client_secret": settings.IAM_CLIENT_SECRET,
                "code": payload.code,
                "redirect_uri": payload.redirect_uri
            }
            res = await client.post(
                f"{settings.IAM_URL}/oauth/token",
                json=req_body,
                headers={"Content-Type": "application/json"}
            )
            if res.status_code != 200:
                try:
                    err_data = res.json()
                    detail = err_data.get("error", "Failed to exchange authorization code")
                    if "error_description" in err_data:
                        detail += f": {err_data['error_description']}"
                except Exception:
                    detail = f"Failed to exchange authorization code (Status: {res.status_code}): {res.text[:200]}"
                raise HTTPException(status_code=res.status_code, detail=detail)
                
            tokens = res.json()
            
            # Decode the access token to get user info and provision/upsert locally
            access_token = tokens["access_token"]
            claims = await decode_iam_token(access_token)
            
            email = claims.get("email")
            if not email:
                raise HTTPException(status_code=400, detail="IAM access token is missing email claim")
                
            users_col = MongoDB.get_collection("users")
            user = await users_col.find_one({"email": email})
            
            if not user:
                # Check if this is the first user in the database
                is_db_empty = await users_col.count_documents({}) == 0
                user = {
                    "googleId": claims.get("sub", ""),
                    "email": email,
                    "name": claims.get("name", email.split("@")[0].capitalize()),
                    "avatarUrl": "",
                    "role": "admin" if is_db_empty else "member",
                    "disabled": False,
                    "createdAt": datetime.now(timezone.utc),
                    "updatedAt": datetime.now(timezone.utc)
                }
                insert_res = await users_col.insert_one(user)
                user_id = str(insert_res.inserted_id)
            else:
                user_id = str(user["_id"])
                # Sync name if changed (do NOT sync roles — local database is the source of truth for roles)
                updates = {}
                if claims.get("name") and user.get("name") != claims.get("name"):
                    updates["name"] = claims.get("name")
                if updates:
                    updates["updatedAt"] = datetime.now(timezone.utc)
                    await users_col.update_one({"_id": user["_id"]}, {"$set": updates})
                    user.update(updates)

            if user.get("disabled", False):
                raise HTTPException(status_code=403, detail="User account is disabled")

            return {
                "access_token": access_token,
                "refresh_token": tokens.get("refresh_token"),
                "expires_in": tokens.get("expires_in", 900),
                "user": {
                    "id": user_id,
                    "email": email,
                    "name": user.get("name", ""),
                    "avatarUrl": "",
                    "role": user.get("role", "member"),
                    "disabled": False
                }
            }
        except httpx.RequestError as exc:
            raise HTTPException(status_code=503, detail=f"IAM service connection error: {exc}")

@router.post("/refresh")
async def oauth_token_refresh(payload: OAuthRefreshRequest):
    """
    Refreshes access token by calling the IAM token endpoint.
    """
    async with httpx.AsyncClient() as client:
        try:
            req_body = {
                "grant_type": "refresh_token",
                "client_id": settings.IAM_CLIENT_ID,
                "client_secret": settings.IAM_CLIENT_SECRET,
                "refresh_token": payload.refresh_token
            }
            res = await client.post(
                f"{settings.IAM_URL}/oauth/token",
                json=req_body,
                headers={"Content-Type": "application/json"}
            )
            if res.status_code != 200:
                try:
                    err_data = res.json()
                    detail = err_data.get("error", "Failed to refresh token")
                    if "error_description" in err_data:
                        detail += f": {err_data['error_description']}"
                except Exception:
                    detail = f"Failed to refresh token (Status: {res.status_code}): {res.text[:200]}"
                raise HTTPException(status_code=res.status_code, detail=detail)
                
            return res.json()
        except httpx.RequestError as exc:
            raise HTTPException(status_code=503, detail=f"IAM service connection error: {exc}")

@router.post("/revoke")
async def oauth_token_revoke(payload: OAuthRevokeRequest):
    """
    Revokes refresh token by calling the IAM revoke endpoint.
    """
    async with httpx.AsyncClient() as client:
        try:
            req_body = {
                "token": payload.refresh_token
            }
            res = await client.post(
                f"{settings.IAM_URL}/oauth/revoke",
                json=req_body,
                headers={"Content-Type": "application/json"}
            )
            if res.status_code != 200:
                try:
                    err_data = res.json()
                    detail = err_data.get("error", "Failed to revoke token")
                except Exception:
                    detail = f"Failed to revoke token (Status: {res.status_code}): {res.text[:200]}"
                raise HTTPException(status_code=res.status_code, detail=detail)
                
            return {"success": True}
        except httpx.RequestError as exc:
            raise HTTPException(status_code=503, detail=f"IAM service connection error: {exc}")
