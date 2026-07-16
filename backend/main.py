import asyncio
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from db.mongo import MongoDB
from db.redis_client import RedisClient
from routes import auth, collections, environments, auth_functions, executor, ai, profiles, admin, user_guides, flows

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Connect to MongoDB and Redis
    try:
        await MongoDB.connect()
        await RedisClient.connect()
        
        # Seed initial admin users as requested
        users_col = MongoDB.get_collection("users")
        target_emails = ["felix.soewito@gmail.com", "felix.soewito@ninjavan.co"]
        res = await users_col.update_many(
            {"email": {"$in": target_emails}},
            {"$set": {"role": "admin"}}
        )
        if res.modified_count > 0:
            print(f"Seeded/promoted {res.modified_count} users to admin role.")
            
    except Exception as e:
        print(f"ERROR: Failed to connect to services or seed on boot: {e}")
    
    yield
    
    # Shutdown: Close connections
    await MongoDB.close()
    await RedisClient.close()

app = FastAPI(
    title="Lixionary Automation Explorer API",
    version="1.0.0",
    lifespan=lifespan
)

# Configure CORS (Next.js will proxy requests, but keep CORS for development safety)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include all route managers
app.include_router(auth.router)
app.include_router(collections.router)
app.include_router(environments.router)
app.include_router(auth_functions.router)
app.include_router(executor.router)
app.include_router(ai.router)
app.include_router(profiles.router)
app.include_router(admin.router)
app.include_router(user_guides.router)
app.include_router(user_guides.admin_router)
app.include_router(flows.router)

@app.get("/")
def read_root():
    return {
        "status": "healthy",
        "service": "Lixionary Automation Explorer API",
        "mode": "Developer Mode" if settings.DEV_MODE else "Production Mode"
    }

