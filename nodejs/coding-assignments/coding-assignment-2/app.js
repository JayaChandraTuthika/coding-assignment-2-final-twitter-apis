const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");

let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3005, () => {
      console.log("Server Running at http://localhost:3005/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};
initializeDbAndServer();

//middleware function

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

module.exports = app;

//REGISTER API
app.post("/register/", async (request, response) => {
  const { username, name, password, gender } = request.body;

  const hashedPassword = await bcrypt.hash(password, 10);
  console.log(hashedPassword);
  const registerUserQuery = `
            INSERT INTO user (username,name,password,gender)
            VALUES (
                "${username}",
                '${name}',
                '${hashedPassword}',
                '${gender}'
            );`;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    if (password.length > 5) {
      const dbResponse = await db.run(registerUserQuery);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//API 2: LOGIN API
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//API 3:GET TWEETS LATEST
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  let { username } = request;
  console.log(username);
  const selectUsersFollowed = `
                        SELECT follower.following_user_id 
                        FROM follower JOIN user on follower.follower_user_id = user.user_id
                        where user.username = '${username}'`;

  const getTweetsQuery = `
                SELECT user.username,tweet,date_time as dateTime 
                from
                user JOIN tweet on user.user_id = tweet.user_id
                WHERE user.user_id in (${selectUsersFollowed})
                ORDER BY date_time DESC
                LIMIT 4;`;

  const dbResponse = await db.all(getTweetsQuery);
  response.send(dbResponse);
});

//API 4: USER FOLLOWING
app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  console.log(username);
  const selectUsersFollowed = `
                        SELECT follower.following_user_id 
                        FROM follower JOIN user on follower.follower_user_id = user.user_id
                        where user.username = '${username}'`;
  const getUserFollowingQuery = `
                      SELECT name from user
                      WHERE user_id IN (${selectUsersFollowed});`;
  const dbResponse = await db.all(getUserFollowingQuery);
  response.send(dbResponse);
});
//API 5:FOLLOWERS
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  console.log(username);
  const getUserIdQuery = `select user_id from user where username = '${username}'`;

  const selectFollowersQuery = `SELECT follower.follower_user_id 
                FROM follower JOIN user on following_user_id = user.user_id
                WHERE follower.following_user_id IN (${getUserIdQuery})`;

  const getIdQuery = `SELECT user.name from user where user_id in (${selectFollowersQuery});`;
  const users = await db.all(getIdQuery);
  response.send(users);
});
//API 6:GET TWEET
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweetId } = request.params;
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
  const user = await db.get(getUserIdQuery);
  const userId = user.user_id;
  const peopleFollowedByUser = `
                            SELECT follower.following_user_id FROM 
                            follower join user on user.user_id = ${userId}
                            `;
  const tweetFromUser = `SELECT tweet_id FROM tweet where user_id in (${peopleFollowedByUser})
                            AND tweet_id = ${tweetId};`;
  const tweet = await db.get(tweetFromUser);

  if (tweet === undefined) {
    console.log("inside");
    response.status(401);
    response.send("Invalid Request");
  } else {
    console.log("inside");
    const requiredQuery = `
                        SELECT tweet.tweet,
                        COUNT(like.like_id) as likes,
                        COUNT(reply.reply_id) as replies,
                        tweet.date_time as dateTime
                        FROM (tweet LEFT JOIN like on tweet.tweet_id = like.tweet_id ) AS T
                        LEFT JOIN reply on reply.tweet_id = tweet.tweet_id
                        WHERE tweet.tweet_id = ${tweetId}
                        GROUP BY tweet.tweet_id;`;
    const dbResponse = await db.get(requiredQuery);
    response.send(dbResponse);
  }
});

//API 7:GET USERS WHO LIKED TWEET BY USERS

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
    const user = await db.get(getUserIdQuery);
    const userId = user.user_id;
    const peopleFollowedByUser = `
                            SELECT follower.following_user_id FROM 
                            follower join user on user.user_id = ${userId}
                            `;
    const tweetFromUser = `SELECT tweet_id FROM tweet where user_id in (${peopleFollowedByUser})
                            AND tweet_id = ${tweetId};`;
    const tweet = await db.get(tweetFromUser);

    if (tweet === undefined) {
      console.log("inside");
      response.status(401);
      response.send("Invalid Request");
    } else {
      console.log(tweet);
      const requiredQuery = `
                            SELECT user.username 
                           FROM like JOIN user on like.user_id = user.user_id
                            WHERE tweet_id = ${tweetId};
                            `;
      const namesArray = await db.all(requiredQuery);
      let output = [];
      namesArray.forEach((person) => {
        output.push(person.username);
      });
      const likesObj = {
        likes: output,
      };
      response.send(likesObj);
    }
  }
);

//API 8:GET REPLIES OF TWEET BY USERS

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
    const user = await db.get(getUserIdQuery);
    const userId = user.user_id;
    const peopleFollowedByUser = `
                            SELECT follower.following_user_id FROM 
                            follower join user on user.user_id = ${userId}
                            `;
    const tweetFromUser = `SELECT tweet_id FROM tweet where user_id in (${peopleFollowedByUser})
                            AND tweet_id = ${tweetId};`;
    const tweet = await db.get(tweetFromUser);

    if (tweet === undefined) {
      console.log("inside");
      response.status(401);
      response.send("Invalid Request");
    } else {
      console.log(tweet);
      const requiredQuery = `
                            SELECT user.name, reply.reply
                           FROM reply JOIN user on reply.user_id = user.user_id
                            WHERE tweet_id = ${tweetId};
                            `;
      const namesArray = await db.all(requiredQuery);
      // let output = [];
      // namesArray.forEach((person) => {
      //   output.push(person.username);
      // });
      const likesObj = {
        replies: namesArray,
      };
      response.send(likesObj);
    }
  }
);

//API 9:GET ALL TWEETS OF USER
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getTweetIds = `SELECT tweet.tweet_id
                        FROM user join tweet
                        on tweet.user_id = user.user_id
                        WHERE user.username = '${username}'`;
  const tweetsIds = await db.all(getTweetIds);
  const requiredQuery = `
                        SELECT tweet.tweet,
                            count(like.like_id) as likes,
                            count(reply.reply_id) as replies,
                            tweet.date_time as dateTime
                        FROM (tweet LEFT JOIN like ON tweet.tweet_id = like.tweet_id) as T
                        LEFT JOIN reply on reply.tweet_id = tweet.tweet_id
                        WHERE tweet.tweet_id IN (${getTweetIds})
                        GROUP BY tweet.tweet_id
                        ORDER BY tweet.date_time DESC;`;
  const dbResponse = await db.all(requiredQuery);
  response.send(dbResponse);
});

// API 10:CREATE TWEET
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;

  const getUserIdQuery = `SELECT user_id from user WHERE username = '${username}';`;
  const user = await db.get(getUserIdQuery);
  const userId = user.user_id;
  console.log(userId);
  const { tweet } = request.body;
  const date = new Date();
  const dateTime = `${date.getFullYear()}-${
    date.getMonth() + 1
  }-${date.getDate()} ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;
  console.log(dateTime);
  const createTweetQuery = `
                        INSERT INTO tweet (tweet,user_id,date_time)
                        values (
                            '${tweet}',
                            ${userId},
                            '${dateTime}'
                        );`;
  const dbResponse = await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

//DELETE TWEET API
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;

    const user = await db.get(
      `SELECT user_id from user where username = '${username}'`
    );

    const tweetIdsOfUser = `SELECT tweet_id from tweet
                                where user_id = ${user.user_id}`;
    const dbResponse = await db.all(tweetIdsOfUser);
    t = parseInt(tweetId);

    const tweetIdsArray = [];
    dbResponse.forEach((tweet) => {
      tweetIdsArray.push(tweet.tweet_id);
    });

    if (tweetIdsArray.includes(t)) {
      const deleteTweetQuery = `DELETE from tweet
                                WHERE tweet_id = ${tweetId};`;
      const dbRes = await db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);
