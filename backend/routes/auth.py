from datetime import datetime, timedelta, timezone
from typing import Optional
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

def create_jwt_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRY_MINUTES)
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """
    FastAPI dependency to secure routes and retrieve the logged-in user.
    """
    token = credentials.credentials
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token subject")
            
        users_col = MongoDB.get_collection("users")
        user = await users_col.find_one({"_id": ObjectId(user_id)})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
            
        if user.get("disabled", False):
            raise HTTPException(status_code=403, detail="User account is disabled")
            
        # Convert ObjectId to string
        user["id"] = str(user["_id"])
        return user
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Could not validate credentials")

async def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """
    FastAPI dependency to restrict routes to admin users only.
    """
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return current_user


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

    users_col = MongoDB.get_collection("users")
    is_db_empty = await users_col.count_documents({}) == 0
    user = await users_col.find_one({"googleId": google_id})

    if not user:
        # Create new user profile
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

    # Double-check that we do not let a disabled user login
    if user.get("disabled", False):
        raise HTTPException(status_code=403, detail="User account is disabled")

    # Issue local JWT
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
