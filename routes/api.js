// routes/api.js - REPLACE ENTIRE FILE CONTENT WITH THIS UPDATED VERSION

const express = require('express');
const User = require('../models/User');
const Request = require('../models/Request');
const shortid = require('shortid');

module.exports = function(io) {
  const router = express.Router();

  // simple register (returns created user)
  router.post('/auth/register', async (req, res) => {
    try {
      const data = req.body;
      data.userId = data.userId || shortid.generate();
      const existing = await User.findOne({ phone: data.phone });
      if (existing) return res.status(400).json({ error: 'Phone already registered' });
      const user = await User.create(data);
      io.emit('userRegistered', user);
      return res.json({ user });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'register failed' });
    }
  });

  // login (by phone)
  router.post('/auth/login', async (req, res) => {
    const { phone } = req.body;
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json({ user });
  });

  //GK: GET donors by pin
  router.get('/donors', async (req, res) => {
    const { pin, bloodType } = req.query;
    if (!pin) return res.status(400).json({ error: 'pin required' });
    const q = { pinCode: pin };
    if (bloodType) q.bloodType = bloodType;
    const donors = await User.find(q).select('-_id userId name phone pinCode bloodTypejq status');
    res.json({ donors });
  });

  // create request
  router.post('/request', async (req, res) => {
    try {
      // FIX: Block Donor from creating requests
      if (req.body.userRole === 'Donor') {
          return res.status(403).json({ error: 'Donors cannot create blood requests.' });
      }

      const r = await Request.create(req.body);
      io.emit('newRequest', r);
      res.json({ request: r });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'create request failed' });
    }
  });

  // list requests
  router.get('/requests', async (req, res) => {
    const { pin } = req.query;
    const q = pin ? { pinCode: pin } : {};
    const requests = await Request.find(q).sort({ createdAt: -1 });
    res.json({ requests });
  });

  // ADMIN: list pending users (protected with adminSecret query or header)
  router.get('/admin/pending-users', async (req, res) => {
    const secret = req.query.adminSecret || req.headers['x-admin-secret'];
    if (!secret || secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });
    const pending = await User.find({ status: 'PENDING_VERIFICATION' });
    res.json({ pending });
  });

  // ADMIN: approve or deny user
  router.put('/admin/approve-user/:userId', async (req, res) => {
    const secret = req.query.adminSecret || req.headers['x-admin-secret'];
    if (!secret || secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const { userId } = req.params;
      const { action } = req.body; // 'approve' or 'deny'
      const user = await User.findOne({ userId });
      if (!user) return res.status(404).json({ error: 'User not found' });
      user.status = action === 'approve' ? 'VERIFIED' : 'DENIED';
      user.updatedAt = new Date();
      await user.save();
      io.emit('userVerified', { userId: user.userId, status: user.status });
      res.json({ user });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'approve user failed' });
    }
  });

  // ADMIN: approve/deny a request
  router.put('/admin/approve-request/:requestId', async (req, res) => {
    const secret = req.query.adminSecret || req.headers['x-admin-secret'];
    if (!secret || secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const { requestId } = req.params;
      const { action } = req.body; // 'approve' or 'deny'
      
      // Find request by _id
      const reqDoc = await Request.findById(requestId);
      
      const targetReq = reqDoc; 

      if (!targetReq) return res.status(404).json({ error: 'Request not found' });

      if (action === 'approve') {
        // 1. Update the Request document to APPROVED
        targetReq.status = 'APPROVED';
        targetReq.updatedAt = Date.now();
        await targetReq.save();
        
        // 2. IMPORTANT: Update the User (Hospital) document to mark the request as active
        // The requesterId field is available on the Request model
        const hospitalUser = await User.findOne({ userId: targetReq.requesterId }); 
        if (hospitalUser) {
            // isRequestActive is on the User schema
            hospitalUser.isRequestActive = true; 
            // Save the needed blood type and pin code onto the User document for matching logic
            hospitalUser.bloodTypeNeeded = targetReq.bloodTypeNeeded; 
            hospitalUser.requestPinCode = targetReq.pinCode; 
            hospitalUser.updatedAt = new Date(); 
            await hospitalUser.save();
        }

        // 3. Emit socket event
        if (io) io.emit('requestApproved', { 
            requestId: targetReq._id, 
            pinCode: targetReq.pinCode, 
            bloodTypeNeeded: targetReq.bloodTypeNeeded 
        });
        return res.json({ request: targetReq });
      } else {
        // deny
        targetReq.status = 'DENIED';
        targetReq.updatedAt = Date.now();
        await targetReq.save();

        // Also deactivate the request on the User profile if it was active
        const hospitalUser = await User.findOne({ userId: targetReq.requesterId }); 
        if (hospitalUser) {
            hospitalUser.isRequestActive = false; 
            hospitalUser.bloodTypeNeeded = null; 
            hospitalUser.requestPinCode = null; 
            hospitalUser.updatedAt = new Date(); 
            await hospitalUser.save();
        }

        if (io) io.emit('requestDenied', { requestId: targetReq._id });
        return res.json({ request: targetReq });
      }
    } catch (err) {
      console.error('approve-request error', err);
      return res.status(500).json({ error: 'approve request failed' });
    }
  });

  // --- NEW: GLOBAL SYNC ENDPOINT ---
  // This helps the frontend rebuild its "local database" by fetching all users + all requests
  router.get('/sync-storage', async (req, res) => {
    try {
      // 1. Get all users
      const users = await User.find({});
      // 2. Get all requests
      const requests = await Request.find({});
      // 3. Send both back
      res.json({KZ: 'success', users, requests });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Sync failed' });
    }
  });

  return router;
};