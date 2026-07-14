import os

# Helper to load .env and .env.local files manually
def load_env_files():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.dirname(current_dir)
    for env_name in [".env", ".env.local"]:
        env_path = os.path.join(root_dir, env_name)
        if os.path.exists(env_path):
            with open(env_path, "r") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip().strip("'\"")
                    if key not in os.environ:
                        os.environ[key] = val

load_env_files()

class Settings:
    MONGODB_URI: str = os.getenv("MONGODB_URI", "mongodb://localhost:27017/lixionary")
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    BROWSER_CDP_URL: str = os.getenv("BROWSER_CDP_URL", "http://localhost:9222")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    JWT_SECRET: str = os.getenv("JWT_SECRET", "supersecretjwttokenkey12345")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRY_MINUTES: int = 1440 # 24 hours
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")
    DEV_MODE: bool = os.getenv("DEV_MODE", "true").lower() == "true"

    # Lixionary IAM OAuth configuration
    IAM_CLIENT_ID: str = os.getenv("IAM_CLIENT_ID", "ca4d16ef-9a5c-43df-811c-ea9cda47b19a")
    IAM_CLIENT_SECRET: str = os.getenv("IAM_CLIENT_SECRET", "automation_explorer_secret_key_123")
    IAM_URL: str = os.getenv("IAM_URL", "http://host.docker.internal:8080")

settings = Settings()
