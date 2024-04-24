const express = require('express')
const path = require('path')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')

const app = express()
app.use(express.json())

const dbPath = path.join(__dirname, 'twitterClone.db')

const PORT = 3000
db = null

const initializeDBandServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(PORT, () => {
      console.log(`Server started at port ${PORT}`)
    })
  } catch (e) {
    console.log(`ERROR: $(e)`)
  }
}
initializeDBandServer()

//==================API 1==========================//
//Register user

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const getUser = `
  SELECT
    *
  FROM
    user
  WHERE
    username = '${username}'
  `
  const dbUser = await db.get(getUser)
  if (dbUser === undefined) {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
      return
    } else {
      const hashedPassword = await bcrypt.hash(password, 10)
      const registerUserQuery = `
                INSERT INTO
                    user(username,password,name,gender)
                VALUES
                    (
                        '${username}',
                        '${hashedPassword}',
                        '${name}',
                        '${gender}'
                    );
            `
      await db.run(registerUserQuery)
      response.status(200)
      response.send('User created successfully')
    }
  } else {
    response.status(400)
    response.send('User already exists')
    return
  }
})

//==================API 2==========================//
//User Login

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const getUserQuery = `
  SELECT 
    *
  FROM
    user
  WHERE
    username = '${username}';
  `
  const dbUser = await db.get(getUserQuery)

  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordCorrect = await bcrypt.compare(password, dbUser.password)
    // console.log(isPasswordCorrect)
    if (isPasswordCorrect === true) {
      const payload = {username: username}
      const jwtToken = jwt.sign(payload, 'SECRET_KEY')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

//============MIDDLEWARE================//
//Check token authentication
const authenticateToken = (request, response, next) => {
  const authHeader = request.headers['authorization']
  if (authHeader === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    const jwtToken = authHeader.split(' ')[1]
    if (jwtToken === undefined) {
      response.status(401)
      response.send('Invalid JWT Token')
    } else {
      jwt.verify(jwtToken, 'SECRET_KEY', async (error, payload) => {
        if (error) {
          response.status(401)
          response.send('Invalid JWT Token')
        } else {
          request.username = payload.username
          next()
        }
      })
    }
  }
}

//logged user middleware
const loggedUser = async (request, response, next) => {
  const username = request.username
  const getUserIdQuery = `
          SELECT
            *
          FROM
            user
          WHERE
            username = '${username}'
          `
  const dbUser = await db.get(getUserIdQuery)
  const userId = dbUser.user_id
  const name = dbUser.name
  request.name = dbUser.name
  request.userId = userId
  next()
}

//==================API 3===================//
//Returns the latest tweets of people whom the user follows. Return 4 tweets at a time

app.get(
  '/user/tweets/feed/',
  authenticateToken,
  loggedUser,
  async (request, response) => {
    const {userId} = request

    const tweetsQuery = `
    SELECT
      user.username, tweet.tweet, tweet.date_time AS dateTime
    FROM
      follower
    INNER JOIN 
      tweet
    ON 
      follower.following_user_id = tweet.user_id
    INNER JOIN 
      user
    ON 
      tweet.user_id = user.user_id
    WHERE
      follower.follower_user_id = ${userId}
    ORDER BY
      tweet.date_time DESC
    LIMIT 4;`
    const tweets = await db.all(tweetsQuery)
    response.send(tweets)
  },
)

//==================API 4===================//
//Returns the list of all names of people whom the user follows
app.get(
  '/user/following/',
  authenticateToken,
  loggedUser,
  async (request, response) => {
    const {userId} = request
    const tweetsQuery = `
      SELECT
        name
      FROM follower INNER JOIN user on user.user_id = follower.following_user_id
      WHERE follower.follower_user_id = ${userId};
    `
    const data = await db.all(tweetsQuery)
    response.send(data)
  },
)

//==================API 5===================//
//Returns the list of all names of people who follows the user
app.get(
  '/user/followers/',
  authenticateToken,
  loggedUser,
  async (request, response) => {
    const {userId} = request

    const tweetsQuery = `
      SELECT
        name
      FROM follower INNER JOIN user on user.user_id = follower.follower_user_id
      WHERE follower.following_user_id = ${userId};
    `
    const data = await db.all(tweetsQuery)
    response.send(data)
  },
)

//===================API 6=====================//
app.get(
  '/tweets/:tweetId/',
  authenticateToken,
  loggedUser,
  async (request, response) => {
    const {tweetId} = request.params
    const {userId} = request
    const tweetsQuery = `
      SELECT
      *
      FROM tweet
      WHERE tweet_id=${tweetId}
      `
    const tweetResult = await db.get(tweetsQuery)

    const userFollowersQuery = `
      SELECT
      *
      FROM follower INNER JOIN user on user.user_id = follower.following_user_id
      WHERE follower.follower_user_id = ${userId};`
    const userFollowers = await db.all(userFollowersQuery)

    if (
      userFollowers.some(item => item.following_user_id === tweetResult.user_id)
    ) {
      const getUserTweets = `
        SELECT
          tweet.tweet as tweet,
          SUM(like.like_id) as likes,
          SUM(reply.reply) as replies,
          tweet.date_time as dateTime
        FROM
          tweet
        INNER JOIN 
          reply
        ON tweet.tweet_id = reply.tweet_id
        INNER JOIN 
          like
        ON tweet.tweet_id=like.tweet_id
        WHERE
          tweet.tweet_id=${tweetId}
        ;
      `
      const tweet = await db.get(getUserTweets)
      response.send(tweet)
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

//===============API 7=========================//
app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  loggedUser,
  async (request, response) => {
    const {tweetId} = request.params
    const {userId} = request
    const tweetsQuery = `
      SELECT
      *
      FROM tweet
      WHERE tweet_id=${tweetId}
      `
    const tweetResult = await db.get(tweetsQuery)

    const userFollowingQuery = `
      SELECT
      *
      FROM follower INNER JOIN user on user.user_id = follower.following_user_id
      WHERE follower.follower_user_id = ${userId};`
    const userFollowing = await db.all(userFollowingQuery)

    if (
      userFollowing.some(item => item.following_user_id === tweetResult.user_id)
    ) {
      const getUserTweets = `
        SELECT
          user.name
        FROM
          user
        INNER JOIN 
          like
        ON user.user_id = like.user_id
        WHERE
          like.tweet_id=${tweetId}
        ;
      `
      const tweet = await db.all(getUserTweets)
      const likes = tweet.map(each => each.name)

      response.send({likes})
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

//=================API 8=======================//
app.get('/tweets/:tweetId/replies/', async (request, response) => {
  const {tweetId} = request.params
  const {userId} = request
  const tweetsQuery = `
      SELECT
      *
      FROM tweet
      WHERE tweet_id=${tweetId}
      `
  const tweetResult = await db.get(tweetsQuery)

  const userFollowingQuery = `
      SELECT
      *
      FROM follower INNER JOIN user on user.user_id = follower.following_user_id
      WHERE follower.follower_user_id = ${userId};`
  const userFollowing = await db.all(userFollowingQuery)

  if (
    userFollowing.some(item => item.following_user_id === tweetResult.user_id)
  ) {
    const getUserTweets = `
        SELECT
          user.name as name,
          reply.reply as reply
        FROM
          user
        INNER JOIN 
          reply
        ON user.user_id = reply.user_id
        WHERE
          reply.tweet_id=${tweetId}
        ;
      `
    const replies = await db.all(getUserTweets)
    response.send(replies)
  } else {
    response.status(401)
    response.send('Invalid Request')
  }
})

//=================API 9=======================//
//Returns a list of all tweets of the user
app.get(
  '/user/tweets/',
  authenticateToken,
  loggedUser,
  async (request, response) => {
    const {userId} = request

    const getUserTweets = `
    SELECT
      tweet.tweet as tweet,
      SUM(like.like_id) as likes,
      SUM(reply.reply) as replies,
      tweet.date_time as dateTime
    FROM
      tweet
    INNER JOIN 
      reply
    ON tweet.tweet_id = reply.tweet_id
    INNER JOIN 
      like
    ON tweet.tweet_id=like.tweet_id
    WHERE
      tweet.user_id=${userId}
    GROUP BY
      tweet.tweet_id
    ;
    `
    const tweets = await db.all(getUserTweets)
    response.send(tweets)
  },
)

//==========================API 10=====================//
app.post(
  '/user/tweets/',
  authenticateToken,
  loggedUser,
  async (request, response) => {
    const {tweet} = request.body
    const {userId} = request
    const date = new Date()
    const createTweetQuery = `
  INSERT INTO
   tweet(tweet,user_id,date_time)
  VALUES
  (
    '${tweet}',
    ${userId},
    '${date}'
  );
  `
    await db.run(createTweetQuery)
    response.send('Created a Tweet')
  },
)

//============================API 11==========================//
app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  loggedUser,
  async (request, response) => {
    const {tweetId} = request.params
    const {userId} = request

    const getUserTweet = `
      SELECT
        *
      FROM
       tweet
      WHERE
        user_id=${userId} AND tweet_id=${tweetId}
    `
    const dbUser = await db.get(getUserTweet)

    if (dbUser !== undefined) {
      const deleteTweetQuery = `
        DELETE FROM 
          tweet
        WHERE
          user_id = ${userId} AND tweet_id = ${tweetId}
      `
      await db.run(deleteTweetQuery)
      response.send('Tweet Removed')
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

module.exports = app
