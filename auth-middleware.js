const jwt = require('jsonwebtoken');

function requireAuth(...allowedTypes) {
  return (req, res, next) => {
    const token = req.cookies?.cm_auth;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const payload = jwt.verify(token, process.env.SESSION_SECRET);
      if (!allowedTypes.includes(payload.type)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (req.params.id && payload.type !== 'admin') {
        if (parseInt(req.params.id) !== payload.id) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      }
      req.user = payload;
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
  };
}

module.exports = { requireAuth };
