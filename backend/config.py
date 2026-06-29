import os

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
