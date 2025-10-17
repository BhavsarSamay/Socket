import { Server as SocketIOServer } from "socket.io";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import User from "./api/models/userModel.js";
import Chat from "./api/models/chatModel.js";
import ChatMessage from "./api/models/chatMessageModel.js";
import ChatStatus from "./api/models/chatStatusModel.js";
import FCM from "./api/models/fcmModel.js";
import Verification from "./api/models/verificationModel.js";

// Config
const MAX_LOGIN_ATTEMPTS = Number(process.env.LOGIN_ATTEMPTS) || 5;
const LOCK_TIME_DURATION =
  (Number(process.env.LOCK_TIME_DURATION) || 2) * 60 * 1000; // in ms

let io;

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection:", reason);
});

const userSockets = new Map();
const new_userSockets = new Map();

function emitResponse(
  socket,
  { success, event, data = [], message = "ok", extra = {} }
) {
  socket.emit("response", { success, event, data, message, ...extra });
}

function getToken(socket) {
  return socket.handshake.auth?.token || socket.handshake.query?.token;
}

async function authenticate(socket) {
  const token = getToken(socket);
  if (!token) return { ok: false, message: "Authentication required" };
  if (!process.env.JWT_KEY)
    return { ok: false, message: "Server auth not configured" };
  try {
    const decoded = jwt.verify(token, process.env.JWT_KEY || "");
    const { id } = decoded;
    const userData = await User.findById(id);

    if (!userData || userData.status !== 1) {
      return { ok: false, message: "Invalid or expired token" };
    }
    socket.user = userData;
    return { ok: true, user: userData };
  } catch (err) {
    return { ok: false, message: "Invalid or expired token" };
  }
}

function bootstrapPresence(socket, userId) {
  setUserOnline(userId, socket.id);
  socket.join(`user_${userId}`);
}

function setUserOnline(userId, socketId) {
  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set());
  }
  userSockets.get(userId).add(socketId);
}

function setUserOffline(userId, socketId) {
  if (userSockets.has(userId)) {
    userSockets.get(userId).delete(socketId);

    if (userSockets.get(userId).size === 0) {
      userSockets.delete(userId);
    }
  }
}

function isUserOnline(userId) {
  return userSockets.has(userId);
}

const init = (server) => {
  const typingUsers = new Map();

  io = new SocketIOServer(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true,
      transports: ["websocket", "polling"],
      allowEIO3: false,
    },
    maxHttpBufferSize: 1e8, // Allow larger payloads (100 MB)
  });
  io.on("connection", async (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    const token = getToken(socket);

    if (token) {
      const auth = await authenticate(socket);
      if (!auth.ok) {
        return emitResponse(socket, {
          success: false,
          event: "Error",
          data: [],
          message: auth.message,
        });
      }
      const userId = auth.user._id.toString();
      setUserOnline(userId, socket.id);
      await notifyFriendsPresence(userId, true);

      try {
        const userChats = await Chat.find({
          sender_user_id: new mongoose.Types.ObjectId(userId),
          deleted_at: null,
          chat_status: true,
        }).select("room_id");

        userChats.forEach((chat) => {
          socket.join(chat.room_id);
        });
      } catch (err) {
        console.error("❌ Auto-join chats failed:", err);
      }
    }

    // OTP Attempt Calculation
    async function handleFailedLoginAttempt(doc, model) {
      const now = Date.now();

      if (doc.lock_time && now < doc.lock_time) {
        const remaining = Math.ceil((doc.lock_time - now) / (60 * 1000));
        return `Your account is locked. Please try again after ${remaining} minutes.`;
      }

      let failed = (doc.login_attempts || 0) + 1;

      if (failed >= MAX_LOGIN_ATTEMPTS) {
        const lockUntil = now + LOCK_TIME_DURATION;
        await model.findByIdAndUpdate(doc._id, {
          $set: { lock_time: lockUntil },
        });
        return "Too many login attempts. Your account has been temporarily locked.";
      }

      await model.findByIdAndUpdate(doc._id, {
        $set: { login_attempts: failed },
      });

      return null;
    }

    socket.on("send_otp", async ({ country_code, number, resend = 1 }) => {
      try {
        if (!country_code || !number) {
          return emitResponse(socket, {
            success: false,
            event: "send_otp",
            data: [],
            message: "Missing required fields",
          });
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const now = new Date();
        const expires_at = new Date(now.getTime() + 5 * 60 * 1000);

        let user = await User.findOne({ country_code, number });

        if (user) {
          if (user.status !== 1) {
            return emitResponse(socket, {
              success: false,
              event: "send_otp",
              data: [],
              message: "User is inactive",
            });
          }

          if (
            (user.lock_time && now < user.lock_time) ||
            (user.login_attempts || 0) >= MAX_LOGIN_ATTEMPTS
          ) {
            const msg = await handleFailedLoginAttempt(user, User);
            return emitResponse(socket, {
              success: false,
              event: "send_otp",
              data: [],
              message: msg,
            });
          }

          await Verification.updateOne(
            { country_code, number },
            { $set: { code: code, expires_at } },
            { upsert: true }
          );

          await User.findByIdAndUpdate(user._id, {
            $inc: { login_attempts: 1 },
          });

          return emitResponse(socket, {
            success: true,
            event: "send_otp",
            data: [],
            message:
              resend === 1
                ? `Verification code sent successfully : ${code}`
                : `Verification code resent : ${code}`,
          });
        }
        let record = await Verification.findOne({ country_code, number });
        if (record) {
          if (
            (record.lock_time && now < record.lock_time) ||
            (record.login_attempts || 0) >= MAX_LOGIN_ATTEMPTS
          ) {
            const msg = await handleFailedLoginAttempt(record, Verification);
            return emitResponse(socket, {
              success: false,
              event: "send_otp",
              data: [],
              message: msg,
            });
          }

          await Verification.updateOne(
            { country_code, number },
            { $set: { code: code, expires_at }, $inc: { login_attempts: 1 } }
          );
        } else {
          await Verification.create({
            country_code,
            number,
            code: code,
            expires_at,
            login_attempts: 1,
          });
        }
        return emitResponse(socket, {
          success: true,
          event: "send_otp",
          data: [],
          message:
            resend === 1
              ? `Verification code sent successfully : ${code}`
              : `Verification code resent : ${code}`,
        });
      } catch (err) {
        return emitResponse(socket, {
          success: false,
          event: "send_otp",
          data: [],
          message: "Unable to send OTP",
        });
      }
    });

    // OTP Verify
    socket.on(
      "verify_otp",
      async ({ first_name, last_name, country_code, number, code }) => {
        try {
          if (!country_code || !number || !code) {
            return emitResponse(socket, {
              success: false,
              event: "verify_otp",
              data: [],
              message: "Missing required fields",
            });
          }

          const record = await Verification.findOne({
            country_code,
            number,
            code: String(code),
          });

          if (!record) {
            return emitResponse(socket, {
              success: false,
              event: "verify_otp",
              data: [],
              message: "Entered verification code is incorrect.",
            });
          }

          if (record.expires_at && new Date(record.expires_at) < new Date()) {
            return emitResponse(socket, {
              success: false,
              event: "verify_otp",
              data: [],
              message: "Verification code expired.",
            });
          }

          await Verification.deleteOne({ country_code, number });

          let user = await User.findOne({ country_code, number });
          if (!user) {
            user = await User.create({
              first_name: first_name || `${country_code}${number}`,
              last_name: last_name || "",
              country_code,
              number,
            });
          }

          if (user.status !== 1) {
            return socket.emit("response", {
              success: false,
              event: "verify_otp",
              data: [],
              message:
                "Your account is disabled. Please contact administration.",
            });
          }

          const token = jwt.sign(
            { id: user._id, first_name: user.first_name },
            process.env.JWT_KEY || "",
            { expiresIn: "10d" }
          );

          await User.findByIdAndUpdate(user._id, {
            $set: { logged_in_date: new Date(), login_attempts: 0 },
            $unset: { lock_time: 1 },
          });
          return emitResponse(socket, {
            success: true,
            event: "verify_otp",
            data: [],
            message: "Success.",
            extra: { token },
          });
        } catch (err) {
          return emitResponse(socket, {
            success: false,
            event: "verify_otp",
            data: [],
            message: "Unable to verify OTP",
          });
        }
      }
    );

    // Get Profile Details
    socket.on("profile_detail", async function () {
      try {
        const JWTtoken = getToken(socket);

        if (!JWTtoken) {
          return emitResponse(socket, {
            success: false,
            event: "profile_detail",
            data: [],
            message: "Authentication required",
          });
        }

        let decoded;
        try {
          decoded = jwt.verify(JWTtoken, process.env.JWT_KEY || "");
        } catch (err) {
          return emitResponse(socket, {
            success: false,
            event: "profile_detail",
            data: [],
            message: "Authentication failed please try again.",
          });
        }

        const { id } = decoded;
        const userData = await User.findById(id);
        if (!userData || userData.status !== 1) {
          return emitResponse(socket, {
            success: false,
            event: "profile_detail",
            data: [],
            message: "Authentication failed please try again.",
          });
        }

        socket.user = userData;

        return emitResponse(socket, {
          success: true,
          event: "profile_detail",
          data: [
            {
              _id: socket.user._id,
              first_name: socket.user.first_name,
              last_name: socket.user.last_name,
              country_code: socket.user.country_code,
              number: socket.user.number,
              profile_pic: socket.user.profile_pic,
              is_online: socket.user.is_online,
            },
          ],
          message: "ok",
        });
      } catch (error) {
        return emitResponse(socket, {
          success: false,
          event: "profile_detail",
          data: [],
          message: "Something went wrong, please try again later.",
        });
      }
    });

    // Save FCM
    socket.on("save_fcm", async function (object) {
      try {
        const JWTtoken = getToken(socket);

        if (!JWTtoken) {
          return emitResponse(socket, {
            success: false,
            event: "save_fcm",
            data: [],
            message: "Authentication required",
          });
        }

        let decoded;
        try {
          decoded = jwt.verify(JWTtoken, process.env.JWT_KEY || "");
        } catch (err) {
          return emitResponse(socket, {
            success: false,
            event: "save_fcm",
            data: [],
            message: "Authentication failed please try again.",
          });
        }

        const { id } = decoded;
        const userData = await User.findById(id);
        if (!userData || userData.status !== 1) {
          return emitResponse(socket, {
            success: false,
            event: "save_fcm",
            data: [],
            message: "Authentication failed please try again.",
          });
        }

        socket.user = userData;
        const userId = userData._id.toString();

        bootstrapPresence(socket, userId);

        let { device, token, type } = object;
        if (!device || !token || !type) {
          return emitResponse(socket, {
            success: false,
            event: "save_fcm",
            data: [],
            message: "Missing required fields",
          });
        }

        const existing = await FCM.findOne({
          device: device,
          token: token,
          user: socket.user._id,
        });

        if (existing)
          return emitResponse(socket, {
            success: true,
            event: "save_fcm",
            data: [],
            message: "already inserted",
          });
        await FCM.deleteMany({ device: device, user: socket.user._id });

        await FCM.create({
          user: socket.user._id,
          type: type,
          device: device,
          token: token,
        });

        return emitResponse(socket, {
          success: true,
          event: "save_fcm",
          data: [],
          message: "inserted",
        });
      } catch (error) {
        return emitResponse(socket, {
          success: false,
          event: "save_fcm",
          data: [],
          message: "Something went wrong, please try again later.",
        });
      }
    });

    // Send chat request
    socket.on("send_chat_request", async function (object) {
      try {
        const token = getToken(socket);
        if (!token) {
          return emitResponse(socket, {
            success: false,
            event: "send_chat_request",
            data: [],
            message: "Authentication required",
          });
        }

        const auth = await authenticate(socket);
        if (!auth.ok) {
          return emitResponse(socket, {
            success: false,
            event: "send_chat_request",
            data: [],
            message: auth.message,
          });
        }

        const userData = auth.user;
        const userId = auth.user._id.toString();
        bootstrapPresence(socket, userId);

        const { country_code, number } = object;
        if (!number) {
          return emitResponse(socket, {
            success: false,
            event: "send_chat_request",
            data: [],
            message: "Missing required fields",
          });
        }

        let receiver_user = await User.findOne({ number });
        if (!receiver_user || receiver_user.status != 1) {
          return emitResponse(socket, {
            success: false,
            event: "send_chat_request",
            data: [],
            message: "Receiver account does not exist or is inactive.",
          });
        }

        const receiver_id = receiver_user._id.toString();

        const chat = await send_chat_request({
          sender_id: socket.user._id,
          receiver_id,
        });

        if (!chat) {
          return emitResponse(socket, {
            success: false,
            event: "send_chat_request",
            data: [],
            message: "Unable to create chat.",
          });
        }

        emitResponse(socket, {
          success: true,
          event: "send_chat_request",
          data: chat,
          message: "Chat request sent successfully.",
        });

        if (chat && chat.room_id) {
          const roomId = chat.room_id.toString();
          const senderSockets = userSockets.get(userId);
          if (senderSockets) {
            senderSockets.forEach((sid) => {
              io.sockets.sockets.get(sid)?.join(roomId);
            });
          }

          const receiverSockets = userSockets.get(receiver_id);
          if (receiverSockets) {
            receiverSockets.forEach((sid) => {
              io.sockets.sockets.get(sid)?.join(roomId);
            });
          }
        }

        const memberIds = [userId, receiver_id];

        for (const memberId of memberIds) {
          const sockets = userSockets.get(memberId);
          if (!sockets || sockets.size === 0) {
            continue;
          }

          let chatList = [];
          try {
            const fakeSocket = {
              user: memberId === userId ? userData : receiver_user,
            };
            chatList = await get_chat_lists(fakeSocket);
          } catch (e) {
            console.error(`get_chat_lists failed for ${memberId}:`, e);
          }

          sockets.forEach((sid) => {
            emitResponse(io.to(sid), {
              success: true,
              event: "get_chat_lists",
              data: chatList,
              message: `ok`,
            });
          });
        }
      } catch (err) {
        emitResponse(socket, {
          success: false,
          event: "send_chat_request",
          data: [],
          message: "Something went wrong, please try again later.",
        });
      }
    });

    // Get chat list
    socket.on("get_chat_lists", async function () {
      try {
        const token = getToken(socket);

        if (!token) {
          return emitResponse(socket, {
            success: false,
            event: "get_chat_lists",
            data: [],
            message: "Authentication required",
          });
        }

        let decoded;
        try {
          decoded = jwt.verify(token, process.env.JWT_KEY || "");
        } catch (err) {
          return emitResponse(socket, {
            success: false,
            event: "get_chat_lists",
            data: [],
            message: "Invalid or expired token",
          });
        }

        const { id } = decoded;
        const userData = await User.findById(id);
        if (!userData || userData.status !== 1) {
          return emitResponse(socket, {
            success: false,
            event: "get_chat_lists",
            data: [],
            message: "Invalid or expired token",
          });
        }

        socket.user = userData;
        const userId = userData._id.toString();
        bootstrapPresence(socket, userId);

        const response = await get_chat_lists(socket);

        if (response) {
          return emitResponse(socket, {
            success: true,
            event: "get_chat_lists",
            data: response,
            message: "ok",
          });
        } else {
          return emitResponse(socket, {
            success: false,
            event: "get_chat_lists",
            data: [],
            message: "Something went wrong, please try again later.",
          });
        }
      } catch (err) {
        return emitResponse(socket, {
          success: false,
          event: "get_chat_lists",
          data: [],
          message: "Something went wrong, please try again later.",
        });
      }
    });

    // Send chat messages
    socket.on("message", async function (object) {
      const token = getToken(socket);

      if (!token) {
        return emitResponse(socket, {
          success: false,
          event: "message",
          data: [],
          message: "Authentication required",
        });
      }

      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_KEY || "");
      } catch (err) {
        return emitResponse(socket, {
          success: false,
          event: "message",
          data: [],
          message: "Invalid or expired token",
        });
      }

      const { id } = decoded;
      const userData = await User.findById(id);
      if (!userData || userData.status !== 1) {
        return emitResponse(socket, {
          success: false,
          event: "message",
          data: [],
          message: "Invalid or expired token",
        });
      }

      socket.user = userData;
      const userId = userData._id.toString();

      socket.join(`user_${userId}`);
      object.user_id = userData._id;

      let details;
      try {
        details = await send_message(object);
      } catch (err) {
        console.error("❌ Error in send_message:", err);
      }

      if (!details) {
        return emitResponse(socket, {
          success: false,
          event: "message",
          data: [],
          message: "Unable to send message please try again later.",
        });
      }

      const roomId = object.room_id;
      const room_members = await Chat.aggregate([
        { $match: { room_id: roomId } },
      ]);

      const memberIds = room_members.map((m) => m.sender_user_id.toString());

      for (const memberId of memberIds) {
        const sockets = userSockets.get(memberId);
        if (!sockets) continue;

        sockets.forEach((sid) => {
          const isMe = memberId === userData._id.toString();

          emitResponse(io.to(sid), {
            success: true,
            event: "message",
            data: [
              {
                _id: details._id,
                room_id: details.room_id,
                user_id: details.user_id,
                message: details.message,
                message_type: details.message_type,
                user_first_name: userData.first_name,
                user_last_name: userData.last_name,
                user_profile:
                  "https://images.pexels.com/photos/1704488/pexels-photo-1704488.jpeg?_gl=1*hj3uzp*_ga*MTMwNjQ1MjI1Ni4xNzU3NTA1NzAx*_ga_8JE65Q40S6*czE3NTc1MDU3MDAkbzEkZzAkdDE3NTc1MDU3MDAkajYwJGwwJGgw",
                isMe,
                isRead: false,
                createdAt: details.createdAt,
              },
            ],
            message: `Message ${isMe ? "sent" : "received"} successfully`,
          });
        });
      }
    });

    // Get Messages
    socket.on("get_messages", async function (object) {
      const token = getToken(socket);

      if (!token) {
        return emitResponse(socket, {
          success: false,
          event: "get_messages",
          data: [],
          message: "Authentication required",
        });
      }

      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_KEY || "");
      } catch (err) {
        return emitResponse(socket, {
          success: false,
          event: "get_messages",
          data: [],
          message: "Invalid or expired token",
        });
      }

      const { id } = decoded;
      const userData = await User.findById(id);
      if (!userData || userData.status !== 1) {
        return emitResponse(socket, {
          success: false,
          event: "get_messages",
          data: [],
          message: "Invalid or expired token",
        });
      }

      socket.user = userData;
      const userId = userData._id.toString();

      socket.join(`user_${userId}`);
      object.user_id = userData._id;

      if (!object.room_id) {
        return emitResponse(socket, {
          success: false,
          event: "get_messages",
          data: [],
          message: "Missing required fields",
        });
      }
      let list = await get_messages(object);

      if (list) {
        return emitResponse(socket, {
          success: true,
          event: "get_messages",
          data: list,
          message: "ok",
        });
      } else {
        return emitResponse(socket, {
          success: false,
          event: "get_messages",
          data: [],
          message: "Something went wrong, please try again.",
        });
      }
    });

    // Read Messages
    socket.on("read_message", async function (object) {
      try {
        const JWTtoken = getToken(socket);

        if (!JWTtoken) {
          return emitResponse(socket, {
            success: false,
            event: "read_message",
            data: [],
            message: "Authentication required",
          });
        }

        let decoded;
        try {
          decoded = jwt.verify(JWTtoken, process.env.JWT_KEY || "");
        } catch (err) {
          return emitResponse(socket, {
            success: false,
            event: "read_message",
            data: [],
            message: "Authentication failed please try again.",
          });
        }

        const { id } = decoded;
        const userData = await User.findById(id);
        if (!userData || userData.status !== 1) {
          return emitResponse(socket, {
            success: false,
            event: "read_message",
            data: [],
            message: "Authentication failed please try again.",
          });
        }
        
        socket.user = userData;
        const userId = userData._id.toString();

        bootstrapPresence(socket, userId);

        let { room_id, last_read_message_id } = object;
        if (!room_id || !last_read_message_id) {
          return emitResponse(socket, {
            success: false,
            event: "read_message",
            data: [],
            message: "Missing required fields",
          });
          }

        const chatRoom = await Chat.findOne({ room_id: room_id });
        if (!chatRoom) {
          return emitResponse(socket, {
            success: false,
            event: "read_message",
            data: [],
            message: "Room does not exist",
          });
        }

        const filter = {
          user_id: new mongoose.Types.ObjectId(userId),
          room_id: room_id,
        };

        const update = {
          last_read_message_id: new mongoose.Types.ObjectId(
            last_read_message_id
          ),
        };

        const options = { upsert: true, new: true };

        await ChatStatus.findOneAndUpdate(filter, update, options);

        return emitResponse(socket, {
          success: true,
          event: "read_message",
          data: [],
          message: "ok",
        });
      } catch (error) {
        return emitResponse(socket, {
          success: false,
          event: "read_message",
          data: [],
          message: "Something went wrong, please try again later.",
        });
      }
    });

    // Typing Event
    socket.on("typing", async function (object) {
      try {
        const JWTtoken = getToken(socket);

        if (!JWTtoken) {
          return emitResponse(socket, {
            success: false,
            event: "typing",
            data: [],
            message: "Authentication required",
          });
        }

        let decoded;
        try {
          decoded = jwt.verify(JWTtoken, process.env.JWT_KEY || "");
        } catch (err) {
          return emitResponse(socket, {
            success: false,
            event: "typing",
            data: [],
            message: "Authentication failed please try again.",
          });
        }

        const { id } = decoded;
        const userData = await User.findById(id);
        if (!userData || userData.status !== 1) {
          return emitResponse(socket, {
            success: false,
            event: "typing",
            data: [],
            message: "Authentication failed please try again.",
          });
        }

        socket.user = userData;
        const userId = userData._id.toString();

        bootstrapPresence(socket, userId);

        let { room_id } = object;
        if (!room_id) {
          return emitResponse(socket, {
            success: false,
            event: "typing",
            data: [],
            message: "Missing required fields",
          });
        }

        const chatRoom = await Chat.findOne({ room_id: room_id });
        if (!chatRoom) {
          return emitResponse(socket, {
            success: false,
            event: "typing",
            data: [],
            message: "Room does not exist",
          });
        }

        let response = await get_all_members(object);

        if (response) {
          if (response.length > 0) {
            const memberIds = response.map((m) => m.sender_user_id.toString());

            for (const memberId of memberIds) {
              if (memberId === userId) continue; // don't send back to self

              const sockets = userSockets.get(memberId);
              if (!sockets) continue; // offline

              sockets.forEach((sid) => {
                emitResponse(io.to(sid), {
                  success: true,
                  event: "typing",
                  data: [
                    {
                      room_id: room_id,
                      is_group: chatRoom.chat_type == "group" ? true : false,
                      first_name: userData.user.first_name,
                      last_name: userData.user.last_name,
                    },
                  ],
                  message: "ok",
                });
              });
            }
          }
        }
      } catch (error) {
        return emitResponse(socket, {
          success: false,
          event: "typing",
          data: [],
          message: "Something went wrong, please try again later.",
        });
      }
    });

    // Typing Event
    socket.on("typing_start", async function (object) {
      try {
        const JWTtoken = getToken(socket);

        if (!JWTtoken) {
          return emitResponse(socket, {
            success: false,
            event: "typing_start",
            data: [],
            message: "Authentication required",
          });
        }

        let decoded;
        try {
          decoded = jwt.verify(JWTtoken, process.env.JWT_KEY || "");
        } catch (err) {
          return emitResponse(socket, {
            success: false,
            event: "typing_start",
            data: [],
            message: "Authentication failed please try again.",
          });
        }

        const { id } = decoded;
        const userData = await User.findById(id);
        if (!userData || userData.status !== 1) {
          return emitResponse(socket, {
            success: false,
            event: "typing_start",
            data: [],
            message: "Authentication failed please try again.",
          });
        }

        socket.user = userData;
        const userId = userData._id.toString();

        bootstrapPresence(socket, userId);

        let { room_id } = object;
        if (!room_id) {
          return emitResponse(socket, {
            success: false,
            event: "typing_start",
            data: [],
            message: "Missing required fields",
          });
        }

        const chatRoom = await Chat.findOne({ room_id: room_id });
        if (!chatRoom) {
          return emitResponse(socket, {
            success: false,
            event: "typing_start",
            data: [],
            message: "Room does not exist",
          });
        }

        if (!new_userSockets.has(userId)) {
          new_userSockets.set(userId, new Set());
        }
        new_userSockets.get(userId).add(socket.id);

        if (!typingUsers.has(room_id)) {
          typingUsers.set(room_id, new Map());
        }

        const roomTypers = typingUsers.get(room_id);

        if (roomTypers.has(userId) && roomTypers.get(userId).timeout) {
          clearTimeout(roomTypers.get(userId).timeout);
        }

        const timeout = setTimeout(() => {
          const roomTypers = typingUsers.get(room_id);
          if (roomTypers && roomTypers.has(userId)) {
            roomTypers.delete(userId);
            emitTypingList(io, socket, room_id, chatRoom);
          }
        }, 3000);

        roomTypers.set(userId, {
          username: `${userData.first_name || ""} ${
            userData.last_name || ""
          }`.trim(),
          timestamp: Date.now(),
          timeout,
        });

        emitTypingList(io, socket, room_id, chatRoom);

        return emitResponse(socket, {
          success: true,
          event: "typing_start",
          data: [
            {
              room_id,
              is_group: chatRoom.chat_type === "group",
              first_name: userData?.first_name,
              last_name: userData?.last_name,
            },
          ],
          message: "ok",
        });
      } catch (error) {
        return emitResponse(socket, {
          success: false,
          event: "typing_start",
          data: [],
          message: "Something went wrong, please try again later.",
        });
      }
    });

    function emitTypingList(io, socket, room_id, chatRoom) {
      const roomTypers = typingUsers.get(room_id);
      const typingList = Array.from(roomTypers.entries()).map(([id, data]) => ({
        user_id: id,
        username: data.username || "",
      }));

      const socketsInRoom = Array.from(
        io.sockets.adapter.rooms.get(room_id) || []
      );

      socketsInRoom.forEach((sid) => {
        emitResponse(io.to(sid), {
          success: true,
          event: "typing_start",
          data: [
            {
              room_id,
              is_group: chatRoom.chat_type === "group",
              typing_users: typingList,
            },
          ],
          message: "ok",
        });
      });
    }

    // Create Group
    socket.on("create_group", async function (object) {
      try {
        const JWTtoken = getToken(socket);

        if (!JWTtoken) {
          return emitResponse(socket, {
            success: false,
            event: "create_group",
            data: [],
            message: "Authentication required",
          });
        }

        let decoded;
        try {
          decoded = jwt.verify(JWTtoken, process.env.JWT_KEY || "");
        } catch (err) {
          return emitResponse(socket, {
            success: false,
            event: "create_group",
            data: [],
            message: "Authentication failed please try again.",
          });
        }

        const { id } = decoded;
        const userData = await User.findById(id);
        if (!userData || userData.status !== 1) {
          return emitResponse(socket, {
            success: false,
            event: "create_group",
            data: [],
            message: "Authentication failed please try again.",
          });
        }

        socket.user = userData;
        const userId = userData._id.toString();

        bootstrapPresence(socket, userId);

        let { numbers, group_name } = object;
        if (!numbers || typeof numbers !== "string" || numbers.trim() === "") {
          return emitResponse(socket, {
            success: false,
            event: "create_group",
            data: [],
            message: "Missing required fields",
          });
        }

        numbers = numbers
          .split(",")
          .map((num) => num.replace(/\s+/g, "").trim())
          .filter((num) => num !== "");

        if (numbers.length === 0) {
          return emitResponse(socket, {
            success: false,
            event: "create_group",
            data: [],
            message: "Invalid numbers provided",
          });
        }

        const group = await create_group_chat({
          creator_id: userId,
          numbers,
          group_name,
        });

        if (!group) {
          return emitResponse(socket, {
            success: false,
            event: "create_group",
            data: [],
            message: "Unable to create group",
          });
        }
        const room_id = group.room_id;

        const allNumbers = [userData.number, ...numbers];
        const members = await User.find({
          number: { $in: allNumbers },
          status: 1,
        });

        members.forEach((member) => {
          const memberSockets = userSockets.get(member._id.toString());
          if (memberSockets) {
            memberSockets.forEach((sid) => {
              io.sockets.sockets.get(sid)?.join(room_id);
            });
          }
        });

        emitResponse(socket, {
          success: true,
          event: "create_group",
          data: group,
          message: "Group created successfully",
        });

        for (const member of members) {
          const sockets = userSockets.get(member._id.toString());
          if (!sockets || sockets.size === 0) continue;

          let chatList = [];
          try {
            const fakeSocket = { user: member };
            chatList = await get_chat_lists(fakeSocket);
          } catch (err) {
            console.error(`get_chat_lists failed for ${member._id}:`, err);
          }

          sockets.forEach((sid) => {
            emitResponse(io.to(sid), {
              success: true,
              event: "get_chat_lists",
              data: chatList,
              message: "ok",
            });
          });
        }
      } catch (error) {
        return emitResponse(socket, {
          success: false,
          event: "create_group",
          data: [],
          message: "Something went wrong, please try again later.",
        });
      }
    });

    // Get All Members of group
    socket.on("member_list", async function (object) {
      try {
        const JWTtoken = getToken(socket);

        if (!JWTtoken) {
          return emitResponse(socket, {
            success: false,
            event: "member_list",
            data: [],
            message: "Authentication required",
          });
        }

        let decoded;
        try {
          decoded = jwt.verify(JWTtoken, process.env.JWT_KEY || "");
        } catch (err) {
          return emitResponse(socket, {
            success: false,
            event: "member_list",
            data: [],
            message: "Authentication failed please try again.",
          });
        }

        const { id } = decoded;
        const userData = await User.findById(id);
        if (!userData || userData.status !== 1) {
          return emitResponse(socket, {
            success: false,
            event: "member_list",
            data: [],
            message: "Authentication failed please try again.",
          });
        }

        socket.user = userData;
        const userId = userData._id.toString();

        bootstrapPresence(socket, userId);

        let { room_id } = object;
        if (!room_id) {
          return emitResponse(socket, {
            success: false,
            event: "member_list",
            data: [],
            message: "Missing required fields",
          });
        }

        const response = await get_all_members_with_details(object);

        if (response) {
          return emitResponse(socket, {
            success: true,
            event: "member_list",
            data: response,
            message: "ok",
          });
        } else {
          return emitResponse(socket, {
            success: false,
            event: "member_list",
            data: [],
            message: "Something went wrong, please try again later.",
          });
        }
      } catch (error) {
        return emitResponse(socket, {
          success: false,
          event: "member_list",
          data: [],
          message: "Something went wrong, please try again later.",
        });
      }
    });

    // Member can message in group
    socket.on("member_can_message", async function (object) {
      const { room_id, status } = object;

      const response = await get_all_members(object);

      if (response) {
        if (response.length > 0) {
          const memberIds = response.map((m) => m.sender_user_id.toString());

          for (const memberId of memberIds) {
            const sockets = userSockets.get(memberId);
            if (!sockets) continue;

            sockets.forEach((sid) => {
              const isMe = memberId === userData._id.toString();

              emitResponse(io.to(sid), {
                success: true,
                event: "member_can_message",
                data: [
                  {
                    can_message: status,
                    room_id: room_id,
                  },
                ],
                message: `ok`,
              });
            });
          }
        }
      } else {
        return emitResponse(socket, {
          success: false,
          event: "member_can_message",
          data: [],
          message: "Something went wrong, please try again later.",
        });
      }
    });
  
    // Remove member from group
    socket.on("remove_member", async function (object) {
      try {
        const JWTtoken = getToken(socket);

        if (!JWTtoken) {
          return emitResponse(socket, {
            success: false,
            event: "remove_member",
            data: [],
            message: "Authentication required",
          });
        }

        let decoded;
        try {
          decoded = jwt.verify(JWTtoken, process.env.JWT_KEY || "");
        } catch (err) {
          return emitResponse(socket, {
            success: false,
            event: "remove_member",
            data: [],
            message: "Authentication failed please try again.",
          });
        }

        const { id } = decoded;
        const userData = await User.findById(id);
        if (!userData || userData.status !== 1) {
          return emitResponse(socket, {
            success: false,
            event: "remove_member",
            data: [],
            message: "Authentication failed please try again.",
          });
        }

        socket.user = userData;
        const userId = userData._id.toString();

        bootstrapPresence(socket, userId);

        let { ref_id } = object;
        if (!ref_id) {
          return emitResponse(socket, {
            success: false,
            event: "remove_member",
            data: [],
            message: "Missing required fields",
          });
        }

        let details = await Chat.findByIdAndUpdate(ref_id, {
          $set: {
            deleted_at: Date(),
          },
        });

        if (!details) {
          return emitResponse(socket, {
            success: false,
            event: "remove_member",
            data: [],
            message: "Entered details are invalid",
          });
        }
        object.room_id = details.room_id;

        const response = await get_all_members_with_details(object);

        if (response) {
          emitResponse(socket, {
            success: true,
            event: "remove_member",
            data: [],
            message: "ok",
          });
        }

        const sockets = userSockets.get(details?.sender_user_id?.toString());
        if (!sockets) return;

        const chat_list = await get_chat_lists({
          user: {
            _id: new mongoose.Types.ObjectId(details?.sender_user_id),
          },
        });

        sockets.forEach((sid) => {
          emitResponse(io.to(sid), {
            success: true,
            event: "get_chat_lists",
            data: chat_list,
            message: `ok`,
          });
        });
      } catch (error) {
        return emitResponse(socket, {
          success: false,
          event: "remove_member",
          data: [],
          message: "Something went wrong, please try again later.",
        });
      }
    });
    // Add Member in group
    socket.on("add_member", async function (object) {
      try {
        const JWTtoken = getToken(socket);

        if (!JWTtoken) {
          return emitResponse(socket, {
            success: false,
            event: "add_member",
            data: [],
            message: "Authentication required",
          });
        }

        let decoded;
        try {
          decoded = jwt.verify(JWTtoken, process.env.JWT_KEY || "");
        } catch (err) {
          return emitResponse(socket, {
            success: false,
            event: "add_member",
            data: [],
            message: "Authentication failed please try again.",
          });
        }

        const { id } = decoded;
        const userData = await User.findById(id);
        if (!userData || userData.status !== 1) {
          return emitResponse(socket, {
            success: false,
            event: "add_member",
            data: [],
            message: "Authentication failed please try again.",
          });
        }

        socket.user = userData;
        const userId = userData._id.toString();

        bootstrapPresence(socket, userId);

        let { number, room_id } = object; // 👈 include removed_user_id in object
        if (!number || !room_id) {
          return emitResponse(socket, {
            success: false,
            event: "add_member",
            data: [],
            message: "Missing required fields",
          });
        }

        let receiver_user = await User.findOne({ number });

        if (!receiver_user || receiver_user.status != 1) {
          return emitResponse(socket, {
            success: false,
            event: "add_member",
            data: [],
            message: "Receiver account does not exist or is inactive.",
          });
        }

        const receiver_id = receiver_user._id.toString();

        const chatRoom = await Chat.findOne({ room_id: room_id });
        if (!chatRoom) {
          return emitResponse(socket, {
            success: false,
            event: "add_member",
            data: [],
            message: "Room does not exist",
          });
        }

        const check_duplicate = await Chat.findOne({
          sender_user_id: new mongoose.Types.ObjectId(receiver_id),
          room_id: room_id,
          deleted_at: null,
        });

        if (check_duplicate) {
          return emitResponse(socket, {
            success: true,
            event: "add_member",
            data: [],
            message: "Member already exist in group.",
          });
        }

        await Chat.create({
          sender_user_id: receiver_id,
          creator_user_id: chatRoom.creator_user_id,
          room_id: room_id,
          chat_type: "group",
          name: chatRoom.name,
        });

        const response = await get_all_members_with_details(object);

        if (response) {
          emitResponse(socket, {
            success: true,
            event: "add_member",
            data: [],
            message: "ok",
          });
        }

        const sockets = userSockets.get(receiver_id);
        if (!sockets) return;

        const chat_list = await get_chat_lists({
          user: {
            _id: new mongoose.Types.ObjectId(receiver_id),
          },
        });

        sockets.forEach((sid) => {
          emitResponse(io.to(sid), {
            success: true,
            event: "get_chat_lists",
            data: chat_list,
            message: `ok`,
          });
        });
      } catch (error) {
        return emitResponse(socket, {
          success: false,
          event: "add_member",
          data: [],
          message: "Something went wrong, please try again later.",
        });
      }
    });

    // Logout
    socket.on("logout", async function (object) {
      try {
        const token = getToken(socket);

        if (!token) {
          return emitResponse(socket, {
            success: false,
            event: "logout",
            data: [],
            message: "Authentication required",
          });
        }

        let decoded;
        try {
          decoded = jwt.verify(token, process.env.JWT_KEY || "");
        } catch (err) {
          return emitResponse(socket, {
            success: false,
            event: "logout",
            data: [],
            message: "Invalid or expired token",
          });
        }

        const { id } = decoded;
        const userData = await User.findById(id);
        if (!userData || userData.status !== 1) {
          return emitResponse(socket, {
            success: false,
            event: "logout",
            data: [],
            message: "Invalid or expired token",
          });
        }

        socket.user = userData;
        const userId = userData._id.toString();

        bootstrapPresence(socket, userId);

        let { device } = object;

        if (device) {
          await FCM.deleteMany({ device, user: socket.user._id });
        }

        const wentOffline = setUserOffline(userData._id.toString(), socket.id);
        if (wentOffline) {
          await notifyFriendsPresence(userData._id.toString(), false);
        }

        return emitResponse(socket, {
          success: true,
          event: "logout",
          data: [],
          message: "Logged out successfully.",
        });
      } catch (error) {
        return emitResponse(socket, {
          success: false,
          event: "logout",
          data: [],
          message: "Something went wrong, please try again later.",
        });
      }
    });

    socket.on("disconnect", async () => {
      console.log(`Socket disconnected: ${socket.id}`);

      if (socket.user) {
        const userId = socket.user._id?.toString();
        const wentOffline = setUserOffline(userId, socket.id);
        if (wentOffline) {
          await notifyFriendsPresence(userId, false);
        }

        const sockets = new_userSockets.get(userId);
        sockets?.delete(socket.id);

        if (sockets?.size === 0) {
          new_userSockets.delete(userId);
          for (const [roomId, roomTypers] of typingUsers.entries()) {
            if (roomTypers.has(userId)) {
              roomTypers.delete(userId);
              if (roomTypers.size === 0) typingUsers.delete(roomId);
            }
          }
        }
      }
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized!");
  }
  return io;
};

const send_chat_request = async (object) => {
  try {
    let { sender_id, receiver_id, event_id } = object;

    let roomOne = `chat_${sender_id}_${receiver_id}`;
    let roomTwo = `chat_${receiver_id}_${sender_id}`;

    if (event_id) {
      roomOne = `${roomOne}_${event_id}`;
      roomTwo = `${roomTwo}_${event_id}`;
    }

    let chat = await Chat.findOne({
      room_id: { $in: [roomOne, roomTwo] },
    });

    if (chat) {
      const receiver = await User.findById(receiver_id, "first_name last_name");

      let chatData = chat.toObject();
      chatData.first_name = receiver?.first_name || "";
      chatData.last_name = receiver?.last_name || "";
      chatData.profile =
        "https://images.pexels.com/photos/1704488/pexels-photo-1704488.jpeg?_gl=1*hj3uzp*_ga*MTMwNjQ1MjI1Ni4xNzU3NTA1NzAx*_ga_8JE65Q40S6*czE3NTc1MDU3MDAkbzEkZzAkdDE3NTc1MDU3MDAkajYwJGwwJGgw";
      chatData.is_online = isUserOnline(receiver_id.toString());

      return chatData;
    }

    chat = await Chat.create({
      sender_user_id: sender_id,
      creator_user_id: sender_id,
      room_id: roomOne,
      chat_type: "private",
      chat_status: 1,
    });

    await Chat.create({
      sender_user_id: receiver_id,
      creator_user_id: sender_id,
      room_id: roomOne,
      chat_type: "private",
      chat_status: 1,
    });

    const receiver = await User.findById(receiver_id, "first_name last_name");

    let chatData = chat.toObject();
    chatData.first_name = receiver?.first_name || "";
    chatData.last_name = receiver?.last_name || "";
    chatData.is_online = isUserOnline(receiver_id.toString());
    chatData.profile =
      "https://images.pexels.com/photos/1704488/pexels-photo-1704488.jpeg?_gl=1*hj3uzp*_ga*MTMwNjQ1MjI1Ni4xNzU3NTA1NzAx*_ga_8JE65Q40S6*czE3NTc1MDU3MDAkbzEkZzAkdDE3NTc1MDU3MDAkajYwJGwwJGgw";

    return chatData;
  } catch (err) {
    return false;
  }
};

const get_chat_lists = async (socket) => {
  try {
    const senderId = new mongoose.Types.ObjectId(socket.user._id);

    let chats = await Chat.aggregate([
      {
        $match: {
          $and: [
            { sender_user_id: senderId },
            { chat_status: true },
            { deleted_at: null },
          ],
        },
      },
      {
        $lookup: {
          from: "chatmessages",
          let: { roomId: "$room_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$room_id", "$$roomId"] } } },
            { $sort: { created_at: -1 } },
            { $limit: 1 },
          ],
          as: "last_message",
        },
      },
      { $unwind: { path: "$last_message", preserveNullAndEmptyArrays: true } },
      { $sort: { "last_message.created_at": -1, created_at: -1 } },
      {
        $lookup: {
          from: "chats",
          let: { roomId: "$room_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$room_id", "$$roomId"] } } },
            {
              $project: {
                user_id: "$sender_user_id",
              },
            },
          ],
          as: "participants",
        },
      },
      {
        $addFields: {
          other_user_id: {
            $first: {
              $filter: {
                input: "$participants",
                as: "p",
                cond: { $ne: ["$$p.user_id", senderId] },
              },
            },
          },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "other_user_id.user_id",
          foreignField: "_id",
          as: "other_user",
          pipeline: [{ $limit: 1 }],
        },
      },
      { $unwind: { path: "$other_user", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          is_owner: {
            $cond: {
              if: { $eq: ["$chat_type", "private"] },
              then: true,
              else: {
                $cond: {
                  if: { $eq: ["$sender_user_id", "$creator_user_id"] },
                  then: true,
                  else: false,
                },
              },
            },
          },
          profile: {
            $cond: {
              if: { $eq: ["$chat_type", "private"] },
              then: "https://images.pexels.com/photos/1704488/pexels-photo-1704488.jpeg?_gl=1*hj3uzp*_ga*MTMwNjQ1MjI1Ni4xNzU3NTA1NzAx*_ga_8JE65Q40S6*czE3NTc1MDU3MDAkbzEkZzAkdDE3NTc1MDU3MDAkajYwJGwwJGgw",
              else: "https://images.unsplash.com/photo-1506869640319-fe1a24fd76dc?fm=jpg&q=60&w=3000&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8M3x8Z3JvdXAlMjBvZiUyMGZyaWVuZHxlbnwwfHwwfHx8MA%3D%3D",
            },
          },
        },
      },
      {
        $lookup: {
          from: "chatstatuses",
          let: { roomId: "$room_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$room_id", "$$roomId"] },
                    {
                      $eq: ["$user_id", senderId],
                    },
                  ],
                },
              },
            },
            {
              $project: {
                last_read_message_id: 1,
              },
            },
          ],
          as: "userReadStatus",
        },
      },
      {
        $unwind: {
          path: "$userReadStatus",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "chatmessages",
          let: {
            roomId: "$room_id",
            lastReadId: "$userReadStatus.last_read_message_id",
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$room_id", "$$roomId"] },
                    {
                      $ne: ["$user_id", senderId],
                    },
                    {
                      $cond: [
                        {
                          $ifNull: ["$$lastReadId", false],
                        },
                        {
                          $gt: ["$_id", "$$lastReadId"],
                        },
                        true,
                      ],
                    },
                  ],
                },
              },
            },
            {
              $count: "unread_count",
            },
          ],
          as: "unreadMessages",
        },
      },
      {
        $addFields: {
          count: {
            $cond: [
              {
                $gt: [{ $size: "$unreadMessages" }, 0],
              },
              {
                $let: {
                  vars: {
                    count: {
                      $arrayElemAt: ["$unreadMessages.unread_count", 0],
                    },
                  },
                  in: {
                    $cond: [
                      { $gt: ["$$count", 99] },
                      "99+",
                      { $toString: "$$count" },
                    ],
                  },
                },
              },
              "",
            ],
          },
        },
      },
      {
        $addFields: {
          sort_time: {
            $ifNull: ["$last_message.createdAt", "$createdAt"],
          },
        },
      },
      {
        $sort: {
          sort_time: -1,
        },
      },
      {
        $project: {
          user_id: "$other_user._id",
          room_id: 1,
          member_can_message: 1,
          mute_chat: 1,
          chat_type: 1,
          is_owner: 1,
          profile: 1,
          name: { $ifNull: ["$name", ""] },
          first_name: {
            $cond: [
              { $eq: ["$chat_type", "private"] },
              { $ifNull: ["$other_user.first_name", ""] },
              "",
            ],
          },
          last_name: {
            $cond: [
              { $eq: ["$chat_type", "private"] },
              { $ifNull: ["$other_user.last_name", ""] },
              "",
            ],
          },
          last_message: {
            $cond: {
              if: { $not: ["$last_message"] },
              then: "",
              else: {
                $cond: [
                  {
                    $eq: ["$last_message.message_type", "text"],
                  },
                  "$last_message.message",
                  "Photo",
                ],
              },
            },
          },
          last_message_type: {
            $ifNull: ["$last_message.message_type", null],
          },
          last_message_time: {
            $ifNull: ["$last_message.createdAt", null],
          },
          unread_count: "$count",
        },
      },
    ]);

    chats = chats.map((chat) => {
      if (chat.user_id) {
        chat.is_online = isUserOnline(chat.user_id.toString());
      } else {
        chat.is_online = false;
      }
      return chat;
    });

    return chats;
  } catch (err) {
    return false;
  }
};

const get_all_members = async (object) => {
  try {
    const { room_id } = object;
    if (!room_id) {
      return false;
    }
    const result = await Chat.aggregate([
      {
        $match: {
          room_id: room_id,
          deleted_at: null,
          chat_status: true,
        },
      },
      {
        $project: {
          _id: 0,
          sender_user_id: 1,
          creator_user_id: 1,
        },
      },
    ]);

    return result;
  } catch (error) {
    return false;
  }
};

const send_message = async (object) => {
  try {
    let new_message = "";

    if (object.message_type === "image") {
      if (!object.message || typeof object.message !== "string") {
        throw new Error("Invalid image payload");
      }

      let base64Data = object.message;

      if (base64Data.includes("base64,")) {
        base64Data = base64Data.split("base64,")[1];
      }

      const buffer = Buffer.from(base64Data, "base64");

      const uploadsDir = path.join(__dirname, "./uploads/chat");
      await fs.promises.mkdir(uploadsDir, { recursive: true });

      const filename = `${Date.now()}.webp`;
      const filePath = path.join(uploadsDir, filename);

      await sharp(buffer).webp({ quality: 80 }).toFile(filePath);

      new_message = (process.env.SITE_URL || "/") + "uploads/chat/" + filename;
    } else {
      new_message = object.message;
    }

    let messageDoc = await ChatMessage.create({
      user_id: object.user_id,
      room_id: object.room_id,
      message: new_message,
      message_type: object.message_type,
    });

    return messageDoc;
  } catch (error) {
    return false;
  }
};

const get_messages = async (object) => {
  try {
    let room_id = object.room_id;
    let user_id = new mongoose.Types.ObjectId(object.user_id);
    let page = object?.page || 1;
    let limit = object?.limit || 20;

    let data = ChatMessage.aggregate([
      {
        $match: {
          room_id: room_id,
        },
      },
      {
        $sort: {
          createdAt: -1,
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "user_id",
          foreignField: "_id",
          as: "user_details",
        },
      },
      {
        $unwind: {
          path: "$user_details",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "chatstatuses",
          let: { roomId: "$room_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$room_id", "$$roomId"] },
                    {
                      $eq: ["$user_id", user_id],
                    },
                  ],
                },
              },
            },
            {
              $project: {
                last_read_message_id: 1,
              },
            },
          ],
          as: "userReadStatus",
        },
      },
      {
        $unwind: {
          path: "$userReadStatus",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          room_id: 1,
          user_id: 1,
          message: 1,
          message_type: 1,
          createdAt: 1,
          user_first_name: { $ifNull: ["$user_details.first_name", null] },
          user_last_name: { $ifNull: ["$user_details.last_name", null] },
          user_profile:
            "https://images.pexels.com/photos/1704488/pexels-photo-1704488.jpeg?_gl=1*hj3uzp*_ga*MTMwNjQ1MjI1Ni4xNzU3NTA1NzAx*_ga_8JE65Q40S6*czE3NTc1MDU3MDAkbzEkZzAkdDE3NTc1MDU3MDAkajYwJGwwJGgw",

          isMe: {
            $cond: [{ $eq: ["$user_id", user_id] }, true, false],
          },
          is_last_read: {
            $cond: {
              if: {
                $and: [
                  { $ne: ["$userReadStatus.last_read_message_id", null] }, // Only compare if exists
                  { $eq: ["$_id", "$userReadStatus.last_read_message_id"] },
                ],
              },
              then: true,
              else: false,
            },
          },
        },
      },
    ]);

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
    };

    let result = await ChatMessage.aggregatePaginate(data, options);

    if (page == 1 && result.docs.length > 0) {
      result.docs[0].is_last_read = false;
    }
    return result;
  } catch (error) {
    return false;
  }
};

const create_group_chat = async ({ creator_id, numbers, group_name }) => {
  try {
    const members = await User.find({
      number: { $in: numbers },
      status: 1,
    });

    const creatorUser = await User.findById(creator_id);
    if (!creatorUser || creatorUser.status !== 1) {
      return false;
    }

    const allMembersMap = new Map();
    allMembersMap.set(creatorUser.number, creatorUser);

    members.forEach((m) => {
      if (!allMembersMap.has(m.number)) {
        allMembersMap.set(m.number, m);
      }
    });

    const allMembers = Array.from(allMembersMap.values()); // ordered: self first

    // if (allMembers.length < 3) {
    //   return false;
    // }

    let room_id = `group_${creator_id}${Date.now()}`;

    const chats = await Promise.all(
      allMembers.map((member) =>
        Chat.create({
          sender_user_id: member._id,
          creator_user_id: creator_id,
          room_id,
          chat_type: "group",
          name: group_name || "New Group",
        })
      )
    );

    let data = chats[0]?.toObject();

    if (data) {
      data.profile =
        "https://images.unsplash.com/photo-1506869640319-fe1a24fd76dc?fm=jpg&q=60&w=3000&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8M3x8Z3JvdXAlMjBvZiUyMGZyaWVuZHxlbnwwfHwwfHx8MA%3D%3D";
    }

    return data;
  } catch (err) {
    return false;
  }
};

const friend_list = async (userId) => {
  try {
    const senderId = new mongoose.Types.ObjectId(userId);

    let data = await Chat.aggregate([
      {
        $match: {
          $and: [
            { sender_user_id: senderId },
            { chat_status: true },
            { deleted_at: null },
          ],
        },
      },
      {
        $lookup: {
          from: "chats",
          let: { roomId: "$room_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$room_id", "$$roomId"] },
              },
            },
            {
              $project: {
                user_id: "$sender_user_id",
              },
            },
          ],
          as: "participants",
        },
      },
      {
        $addFields: {
          other_user_id: {
            $first: {
              $filter: {
                input: "$participants",
                as: "p",
                cond: { $ne: ["$$p.user_id", senderId] },
              },
            },
          },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "other_user_id.user_id",
          foreignField: "_id",
          as: "other_user",
          pipeline: [{ $limit: 1 }],
        },
      },
      {
        $unwind: {
          path: "$other_user",
          preserveNullAndEmptyArrays: true,
        },
      },
    ]);

    return data;
  } catch (error) {
    return false;
  }
};

const get_all_members_with_details = async (object) => {
  try {
    const { room_id } = object;
    if (!room_id) {
      return false;
    }

    const result = await Chat.aggregate([
      {
        $match: {
          room_id: room_id,
          deleted_at: null,
          chat_status: true,
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "sender_user_id",
          foreignField: "_id",
          as: "result",
        },
      },
      {
        $unwind: {
          path: "$result",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $addFields: {
          is_owner: {
            $cond: [
              {
                $eq: ["$sender_user_id", "$creator_user_id"],
              },
              true,
              false,
            ],
          },
        },
      },
      {
        $project: {
          user_id: "$sender_user_id",
          first_name: "$result.first_name",
          last_name: "$result.last_name",
          is_owner: 1,
        },
      },
    ]);

    return result;
  } catch (error) {
    return false;
  }
};

async function notifyFriendsPresence(userId, is_online) {
  try {
    const friends = await friend_list(userId);

    for (const friend of friends) {
      const friendId = friend?.other_user?._id?.toString();

      if (!friendId) {
        continue;
      }

      const sockets = userSockets.get(friendId);
      if (sockets) {
        for (const sockId of sockets) {
          const friendSocket = io.sockets.sockets.get(sockId);

          if (!friendSocket) {
            continue;
          }

          const payload = {
            success: true,
            event: "update_status",
            data: [
              {
                user_id: userId,
                is_online,
                last_seen: is_online ? null : new Date(),
              },
            ],
            message: "ok",
          };

          friendSocket.emit("response", payload);
        }
      }
    }
  } catch (err) {
    console.error("notifyFriendsPresence error:", err);
  }
}

export default { init, getIO };
