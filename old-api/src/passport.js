const passport = require('passport');
const { Strategy: LocalStrategy } = require('passport-local');
const { Strategy: BearerStrategy } = require('passport-http-bearer');
const { Strategy: JwtStrategy } = require('passport-jwt');
const { Strategy: CustomStrategy } = require('passport-custom');

const { User, AccessToken, RefreshToken } = require('./models');

const config = require('./config');

// used to serialize the user for the session
passport.serializeUser(function (user, done) {
  done(null, user._id);
});

// used to deserialize the user
passport.deserializeUser(function (id, done) {
  User.findById(id, function (err, user) {
    done(err, user);
  });
});

async function loginWithPassword(email, password, done) {
  try {
    const user = await User.findOne({ email: email });
    if (!user || !user.validPassword(password)) {
      return done(new Error('invalid credentials'), false);
    }

    // Regardless of whether login is required, if you're logged in as an
    // unverified user, produce an error.
    if (user.needsEmailValidation) {
      return done(new Error('email not verified'), false);
    }

    return done(null, user);
  } catch (err) {
    done(err);
  }
}

passport.use(
  'usernameAndPassword',
  new LocalStrategy(
    {
      usernameField: 'user[email]',
      passwordField: 'user[password]',
      session: false,
    },
    loginWithPassword,
  ),
);

passport.use(
  'usernameAndPasswordSession',
  new LocalStrategy(
    {
      usernameField: 'email',
      passwordField: 'password',
      session: true,
    },
    loginWithPassword,
  ),
);

function getRequestToken(req, tokenTypes = ['Token', 'Bearer']) {
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string') {
    return null;
  }

  const [tokenType, token] = authorization.split(' ');

  if (tokenTypes.includes(tokenType)) {
    return token;
  }

  return null;
}

passport.use(
  'jwt',
  new JwtStrategy(
    {
      secretOrKey: config.jwtSecret,
      jwtFromRequest: getRequestToken,
      algorithms: ['HS256'],
    },
    async function (token, done) {
      try {
        // we used to put the user ID into the token directly :(
        const { id } = token;
        const user = await User.findById(id);
        return done(null, user || false);
      } catch (err) {
        return done(err);
      }
    },
  ),
);

passport.use(
  'accessToken',
  new BearerStrategy(async function (token, done) {
    try {
      const accessToken = await AccessToken.findOne({ token }).populate('user');
      if (accessToken && accessToken.user) {
        // TODO: scope
        return done(null, accessToken.user, { scope: accessToken.scope });
      } else {
        return done(null, false);
      }
    } catch (err) {
      return done(err);
    }
  }),
);

passport.use(
  'refreshToken',
  new BearerStrategy(async function (token, done) {
    try {
      const refreshToken = await RefreshToken.findOne({ token }).populate('user');
      if (refreshToken && refreshToken.user) {
        // TODO: scope
        return done(null, refreshToken.user, { scope: 'auth.refresh' });
      } else {
        return done(null, false);
      }
    } catch (err) {
      return done(err);
    }
  }),
);

passport.use(
  'userId',
  new CustomStrategy(async (req, callback) => {
    try {
      let userId;

      const headerToken = getRequestToken(req, ['OBSUserId']);
      if (headerToken && headerToken.length === 24) {
        userId = headerToken;
      }

      if (!userId) {
        const bodyId = req.body && req.body.id;
        if (bodyId && bodyId.length === 24) {
          userId = bodyId;
        }
      }

      let user;
      if (userId) {
        user = await User.findById(userId);
      }

      callback(null, user || false);
    } catch (err) {
      callback(err);
    }
  }),
);

/**
 * This function creates a middleware that does a passport authentication.
 */
function createMiddleware(strategies, required = true, session = false) {
  return (req, res, next) => {
    passport.authenticate(strategies, { session }, (err, user, info) => {
      // If this authentication produced an error, throw it. In a chain of
      // multiple strategies, errors are ignored, unless every strategy errors.
      if (err) {
        return next(err);
      }

      // If you *must* be logged in for this action, require a user.
      if (required && !user) {
        return res.sendStatus(403);
      }

      // Regardless of whether login is required, if you're logged in as an
      // unverified user, produce an error.
      if (user && user.needsEmailValidation) {
        return res.status(403).json({ errors: { 'E-Mail-Bestätigung': 'noch nicht erfolgt' } });
      }

      req.user = user;
      req.scope = (info && info.scope) || '*';

      return next();
    })(req, res, next);
  };
}

module.exports = {
  // these are the standard authentication mechanisms, for when you want user
  // information in the route, and either require a login, or don't care
  optional: createMiddleware(['jwt', 'accessToken'], false),
  required: createMiddleware(['jwt', 'accessToken'], true),

  // required to check username and passwort for generating a new token, e.g.
  // on the /users/login route, and later on oauth routes
  usernameAndPassword: createMiddleware('usernameAndPassword', true),

  usernameAndPasswordSession: createMiddleware('usernameAndPasswordSession', false, true),

  // will be used to verify a refresh token on the route that will exchange the
  // refresh token for a new access token (not in use yet)
  refreshToken: createMiddleware('refreshToken', true),

  // for track upload, we still allow "userId" for a while
  requiredWithUserId: createMiddleware(['jwt', 'accessToken', 'userId'], true),
};
