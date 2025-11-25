const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  subscription: {
    type: String,
    enum: ['free', 'weekly', 'monthly', 'season'],
    default: 'free'
  },
  subscriptionEnd: {
    type: Date,
    default: null
  },
  stripeCustomerId: {
    type: String,
    default: null
  },
  // ADD THESE TWO NEW FIELDS:
  paymentIntentId: {
    type: String,
    default: null
  },
  purchaseDate: {
    type: Date,
    default: null
  },
  // END OF NEW FIELDS
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date,
    default: Date.now
  }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
