import mongoose from "mongoose";

export class MongoAdapter {
  async connect(): Promise<void> {
    const uri = process.env.MONGO_URI;

    if (!uri) {
      throw new Error("MONGO_URI is not defined");
    }

    try {
      await mongoose.connect(uri);

      console.log("MongoDB connected");
    } catch (error) {
      console.error("MongoDB connection failed:", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await mongoose.disconnect();

    console.log("MongoDB disconnected");
  }
}
