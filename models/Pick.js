const mongoose = require('mongoose');

const pickSchema = new mongoose.Schema({
  week: {
    type: Number,
    required: true
  },
  season: {
    type: Number,
    default: 2024
  },
  game: {
    type: String,
    required: true // e.g., "Chiefs vs Patriots"
  },
  pick: {
    type: String,
    required: true // e.g., "Chiefs -3.5"
  },
  confidence: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Lock'],
    required: true
  },
  result: {
    type: String,
    enum: ['pending', 'win', 'loss', 'push'],
    default: 'pending'
  },
  pickType: {
    type: String,
    enum: ['free', 'premium'],
    required: true
  },
  gameTime: {
    type: Date,
    required: true
  },
  analysis: {
    type: String,
    maxlength: 500
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Pick', pickSchema);
