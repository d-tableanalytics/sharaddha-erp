import mongoose from 'mongoose';

export const connectDatabase = async () => {
  try {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/erp_portal';
    await mongoose.connect(uri);
    console.log(`[Database] MongoDB Connected: ${mongoose.connection.host}`);
  } catch (error) {
    console.error(`[Database Error] ${error.message}`);
    process.exit(1);
  }
};
