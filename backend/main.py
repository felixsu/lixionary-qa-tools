import asyncio
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from db.mongo import MongoDB
from db.redis_client import RedisClient
from routes import auth, collections, environments, auth_functions, executor, ai, browser, profiles, workspace, admin, user_guides

async def cleanup_dangling_containers():
    try:
        from services.docker_client import DockerClient
        docker_client = DockerClient()
        print("Pruning dangling dynamic VNC-browser containers on startup...")
        containers = await docker_client.list_containers(all=True)
        for container in containers:
            names = container.get("Names", [])
            is_dynamic = False
            for name in names:
                if name.startswith("/lixionary-vnc-browser-sess_"):
                    is_dynamic = True
                    break
            if is_dynamic:
                c_name = names[0].lstrip("/")
                print(f"Pruning container: {c_name}")
                try:
                    await docker_client.stop_container(c_name, timeout=5)
                    await docker_client.remove_container(c_name)
                except Exception as e:
                    print(f"Failed to prune container {c_name}: {e}")
    except Exception as e:
        print(f"Error during startup VNC-browser container cleanup: {e}")

async def monitor_idle_sessions():
    from services.browser import BrowserSessionManager
    from db.mongo import MongoDB
    
    print("Starting idle browser session monitor...")
    while True:
        try:
            await asyncio.sleep(60) # Run check every 60 seconds
            
            now = datetime.now(timezone.utc)
            sessions_to_close = []
            
            # Identify sessions disconnected for > 10 minutes (600 seconds)
            for session_id, session_info in list(BrowserSessionManager._sessions.items()):
                disconnected_at = session_info.get("disconnected_at")
                if disconnected_at is not None:
                    idle_duration = (now - disconnected_at).total_seconds()
                    if idle_duration > 600: # 10 minutes
                        print(f"Session {session_id} has been idle for {idle_duration:.1f}s. Closing...")
                        sessions_to_close.append((session_id, session_info.get("user_id")))
            
            # Close the identified idle sessions
            for session_id, user_id in sessions_to_close:
                try:
                    # Fully close session (stops and removes container, stops Playwright)
                    await BrowserSessionManager.close_session(session_id)
                    
                    # Update database status to "closed"
                    if user_id:
                        sessions_col = MongoDB.get_collection("browser_sessions")
                        await sessions_col.update_one(
                            {"session_id": session_id, "user_id": user_id},
                            {"$set": {"status": "closed", "closed_at": now}}
                        )
                except Exception as e:
                    print(f"Error closing idle session {session_id}: {e}")
                    
        except Exception as e:
            print(f"Error in idle session monitor: {e}")

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
            
        # Clean up dynamic browser containers from previous runs
        await cleanup_dangling_containers()
        
        # Start background task to monitor idle sessions
        asyncio.create_task(monitor_idle_sessions())
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
app.include_router(browser.router)
app.include_router(profiles.router)
app.include_router(workspace.router)
app.include_router(admin.router)
app.include_router(user_guides.router)
app.include_router(user_guides.admin_router)

@app.get("/")
def read_root():
    return {
        "status": "healthy",
        "service": "Lixionary Automation Explorer API",
        "mode": "Developer Mode" if settings.DEV_MODE else "Production Mode"
    }
