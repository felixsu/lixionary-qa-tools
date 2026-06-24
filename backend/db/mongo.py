from motor.motor_asyncio import AsyncIOMotorClient
from config import settings

class MongoDB:
    client: AsyncIOMotorClient = None
    db = None

    @classmethod
    async def connect(cls):
        if not cls.client:
            cls.client = AsyncIOMotorClient(settings.MONGODB_URI)
            # Extracted DB name from URI or defaults to lixionary
            db_name = settings.MONGODB_URI.split("/")[-1].split("?")[0] or "lixionary"
            cls.db = cls.client[db_name]
            print(f"Connected to MongoDB database: {db_name}")

    @classmethod
    async def close(cls):
        if cls.client:
            cls.client.close()
            cls.client = None
            cls.db = None
            print("MongoDB connection closed")

    @classmethod
    def get_collection(cls, name: str):
        if cls.db is None:
            raise RuntimeError("MongoDB is not connected. Call connect() first.")
        return cls.db[name]
