const router = require('express').Router();
const wrapRoute = require('../../_helpers/wrapRoute');
const auth = require('../../passport');
const { User } = require('../../models');

// Preload user profile on routes with ':username'
router.param('username', async function (req, res, next, username) {
  try {
    const user = await User.findOne({ username: username });
    if (!user) {
      return res.sendStatus(404);
    }

    req.profile = user;

    return next();
  } catch (err) {
    next(err);
  }
});

router.get(
  '/:username',
  auth.optional,
  wrapRoute(async (req, res) => {
    return res.json({ profile: req.profile.toProfileJSONFor(req.user) });
  }),
);

module.exports = router;
