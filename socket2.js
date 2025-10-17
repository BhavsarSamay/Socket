const socketIO = require("socket.io");
const { default: mongoose, mongo } = require("mongoose");
const jwt = require("jsonwebtoken");
const MessageModel = require("./api/models2/MessageModel");
const GroupMessageModel = require("./api/models2/GroupMessageModel");
const GroupModel = require("./api/models2/GroupModel");
const GroupMemberModel = require("./api/models2/GroupMemberModel");
const UserChatStatusModel = require("./api/models2/ChatCountModel");
const path = require("path")
const sharp = require("sharp")
const fs = require("fs")

const UserModel = require("./api/models/userModel");
// let onlineUsers = new Map();
let io;
module.exports = {
    init: (server) => {
        io = socketIO(server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"],
            },
        });
        const chat_history = async (socket, user_id) => {
            try {
                let currentUserId = new mongoose.Types.ObjectId(socket.user_id);
                let chat = []
                const user_data = await UserModel.findOne({
                    _id: new mongoose.Types.ObjectId(user_id),
                });

                if (user_data) {
                    const chatStatus = await UserChatStatusModel.findOne({
                        user_id: currentUserId,
                        to_user: new mongoose.Types.ObjectId(user_id),
                    });

                    const lastReadMessageId = chatStatus?.last_msg_id || null;

                    chat = await MessageModel.aggregate([
                        {
                            $match: {
                                $or: [
                                    { from: currentUserId, to: new mongoose.Types.ObjectId(user_id) },
                                    { from: new mongoose.Types.ObjectId(user_id), to: currentUserId }
                                ]
                            }
                        },
                        {
                            $lookup: {
                                from: "users",
                                localField: "from",
                                foreignField: "_id",
                                as: "sender"
                            }
                        },
                        {
                            $unwind:
                            {
                                path: "$sender",
                                preserveNullAndEmptyArrays: true
                            }
                        },
                        {
                            $lookup: {
                                from: "users",
                                localField: "to",
                                foreignField: "_id",
                                as: "receiver"
                            }
                        },
                        {
                            $unwind:
                            {
                                path: "$receiver",
                                preserveNullAndEmptyArrays: true
                            }
                        },
                        {
                            $addFields:
                            {
                                isSelf: { $eq: ["$from", currentUserId] },
                                is_last_read: {
                                    $cond: {
                                        if: {
                                            $and: [
                                                { $ne: [lastReadMessageId, null] },
                                                { $eq: ["$_id", lastReadMessageId] },
                                            ],
                                        },
                                        then: true,
                                        else: false,
                                    },
                                },
                            }
                        },
                        {
                            $project: {
                                content: 1,
                                createdAt: 1,
                                senderName: "$sender.number",
                                receiverName: "$receiver.number",
                                isSelf: 1,
                                is_last_read: 1
                            }
                        },
                        { $sort: { createdAt: 1 } }
                    ]);
                }

                if (chat.length > 0) {
                    const lastMessageId = chat[chat.length - 1]._id;

                    await UserChatStatusModel.findOneAndUpdate(
                        {
                            user_id: currentUserId,
                            to_user: new mongoose.Types.ObjectId(user_id),
                        },
                        {
                            last_msg_id: lastMessageId,
                        },
                        {
                            upsert: true,
                            new: true,
                        }
                    );
                }

                socket.emit("ack_chat_history", { chat });

            } catch (error) {
                // console.log(error)
                socket.emit("ack_chat_history", {
                    error: "Failed to fetch chat history",
                });
            }
        };

        const group_history = async (socket, group_id) => {
            try {
                let currentUserId = new mongoose.Types.ObjectId(socket.user_id);
                let chat = []
                const group_data = await GroupModel.findOne({
                    _id: new mongoose.Types.ObjectId(group_id),
                });

                if (group_data) {

                    const chatStatus = await UserChatStatusModel.findOne({
                        user_id: currentUserId,
                        group_id: new mongoose.Types.ObjectId(group_id),
                    });

                    const lastReadMessageId = chatStatus?.last_msg_id || null;

                    chat = await GroupMessageModel.aggregate([
                        {
                            $match: {
                                group_id: new mongoose.Types.ObjectId(group_id)
                            }
                        },
                        {
                            $lookup: {
                                from: "users",
                                localField: "user",
                                foreignField: "_id",
                                as: "userData"
                            }
                        },
                        {
                            $unwind:
                            {
                                path: "$userData",
                                preserveNullAndEmptyArrays: true
                            }
                        },
                        {
                            $sort: {
                                createdAt: 1
                            }
                        },
                        {
                            $addFields: {
                                is_self: {
                                    $eq: ["$user", new mongoose.Types.ObjectId(socket.user_id)],
                                },
                                is_last_read: {
                                    $cond: {
                                        if: {
                                            $and: [
                                                { $ne: [lastReadMessageId, null] },
                                                { $eq: ["$_id", lastReadMessageId] },
                                            ],
                                        },
                                        then: true,
                                        else: false,
                                    },
                                },
                            },
                        },
                        {
                            $project: {
                                content: 1,
                                createdAt: 1,
                                userNumber: { $ifNull: ["$userData.number", ""] },
                                userName: { $ifNull: ["$userData.name", ""] },
                                userId: { $ifNull: ["$userData._id", ""] },
                                is_self: 1,
                                is_last_read: 1,
                            }
                        }
                    ])

                }
                if (chat.length > 0) {
                    const lastMessageId = chat[chat.length - 1]._id;

                    await UserChatStatusModel.findOneAndUpdate(
                        {
                            user_id: currentUserId,
                            group_id: new mongoose.Types.ObjectId(group_id),
                        },
                        {
                            last_msg_id: lastMessageId,
                        },
                        {
                            upsert: true,
                            new: true,
                        }
                    );
                }
                socket.emit("ack_group_history", { chat });
            }
            catch (error) {
                console.log(error)
                socket.emit("ack_group_history", {
                    error: "Failed to fetch group history",
                });
            }
        }

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
                    console.log("Upload Dir", uploadsDir)
                    await fs.promises.mkdir(uploadsDir, { recursive: true });

                    const filename = `${Date.now()}.webp`;
                    const filePath = path.join(uploadsDir, filename);

                    await sharp(buffer).webp({ quality: 80 }).toFile(filePath);

                    new_message = (process.env.SITE_URL || "/") + "uploads/chat/" + filename;
                } else {
                    new_message = object.message;
                }

                let messageDoc = await MessageModel.create({
                    from: new mongoose.Types.ObjectId(object.sender),
                    to: new mongoose.Types.ObjectId(object.receiver),
                    content: new_message,
                    media_type: object.message_type
                });

                // let messageDoc = await ChatMessage.create({
                //     user_id: object.user_id,
                //     room_id: object.room_id,
                //     message: new_message,
                //     message_type: object.message_type,
                // });

                return messageDoc;
            } catch (error) {
                console.log(error)
                return false;
            }
        };
        // You should add event listeners here:
        io.on("connection", async (socket) => {

            const handshake = socket.handshake;
            console.log("A user connected:", socket.id);

            const bearerToken = handshake.query?.auth
            if (!bearerToken) return socket.disconnect(true);

            const decoded = jwt.verify(bearerToken, process.env.JWT_KEY);
            const { id } = decoded;
            let userData = await UserModel.findOne({ _id: id })

            if (!userData || decoded.version !== userData.version || userData.status != 1) {
                return socket.disconnect(true);
            }
            
            socket.user_id = userData._id.toString();
            socket.join(socket.user_id);
            socket.user = userData;
            console.log("Socket Rooms", socket.rooms)
            socket.on("chat_open", async ({ to_user }) => {
                socket.chat_with = to_user?.toString();
                await chat_history(socket, to_user)
            });
            // socket.on("message", async ({ to, content, type = "text" }) => {
            //     try {
            //         if (!mongoose.Types.ObjectId.isValid(to)) {
            //             return socket.emit("ack_message", {
            //                 error: "Invalid User ID",
            //             });
            //         }

            //         const user = await UserModel.findById(to);
            //         if (!user) {
            //             return socket.emit("ack_message", {
            //                 error: "User not found",
            //             });
            //         }

            //         const payloadBase = {
            //             sender: socket.user_id,
            //             receiver: to,
            //             message_type: type,
            //             message: content,
            //         }
            //         const messageDoc = send_message(payloadBase)
            //         console.log("messagDocss",messageDoc)
            //         // const message = await MessageModel.create({
            //         //     from: socket.user_id,
            //         //     to: new mongoose.Types.ObjectId(to),
            //         //     content: content,
            //         //     media_type: type
            //         // });


            //         // const payloadBase = {
            //         //     _id: message._id,
            //         //     sender: socket.user_id,
            //         //     receiver: to,
            //         //     type,
            //         //     content: content,
            //         // }

            //         io.to(to).emit("ack_message", { ...messageDoc, is_self: false });
            //         io.to(socket.user_id).emit("ack_message", { ...messageDoc, is_self: true });

            //         await UserChatStatusModel.findOneAndUpdate(
            //             { user_id: new mongoose.Types.ObjectId(to), to_user: socket.user_id },
            //             { last_msg_id: messageDoc._id },
            //             { upsert: true, new: true }
            //         );

            //     }
            //     catch (error) {
            //         console.error("Error sending message:", error);
            //         socket.emit("ack_message", {
            //             error: "Failed to send message",
            //         });
            //     }
            // });
            socket.on("message", async ({ to, content, type = "text" }) => {
                try {
                    if (!mongoose.Types.ObjectId.isValid(to)) {
                        return socket.emit("ack_message", { error: "Invalid User ID" });
                    }

                    const user = await UserModel.findById(to);
                    if (!user) {
                        return socket.emit("ack_message", { error: "User not found" });
                    }

                    const payloadBase = {
                        sender: socket.user_id,
                        receiver: to,
                        message_type: type,
                        message: content,
                    };

                    // Await here!
                    const messageDoc = await send_message(payloadBase);

                    if (!messageDoc) {
                        return socket.emit("ack_message", { error: "Failed to save message" });
                    }

                    io.to(to).emit("ack_message", { ...messageDoc.toObject(), is_self: false });
                    io.to(socket.user_id).emit("ack_message", { ...messageDoc.toObject(), is_self: true });

                    await UserChatStatusModel.findOneAndUpdate(
                        { user_id: new mongoose.Types.ObjectId(to), to_user: socket.user_id },
                        { last_msg_id: messageDoc._id },
                        { upsert: true, new: true }
                    );

                } catch (error) {
                    console.error("Error sending message:", error);
                    socket.emit("ack_message", { error: "Failed to send message" });
                }
            });

            socket.on("chat_history", async ({ to_user }) => {
                try {
                    await chat_history(socket, to_user);
                } catch (err) {
                    socket.emit("ack_chat_history", {
                        error: "Failed to fetch chat history",
                    });
                }
            });

            socket.on("group_history", async ({ group_id }) => {
                try {
                    if (!mongoose.Types.ObjectId.isValid(group_id)) {
                        return socket.emit("ack_group_history", {
                            error: "Invalid group ID",
                        });
                    }

                    const group = await GroupModel.findById(group_id);
                    if (!group) {
                        return socket.emit("ack_group_history", {
                            error: "Group not found",
                        });
                    }

                    const isMember = await GroupMemberModel.exists({
                        group_id: group_id,
                        member: new mongoose.Types.ObjectId(socket.user_id),
                    });

                    if (!isMember) {
                        return socket.emit("ack_group_history", {
                            error: "You are not a member of this group",
                        });
                    }

                    socket.join(group_id.toString());
                    console.log(`User ${socket.user_id} joined group ${group_id}`);

                    await group_history(socket, group_id);
                }
                catch (err) {
                    console.error("Error fetching group history:", err);
                    socket.emit("ack_group_history", {
                        error: "Failed to fetch group history",
                    });
                }
            });

            socket.on("get_auth", async () => {
                try {

                    let userData = await UserModel.aggregate([
                        { $match: { _id: new mongoose.Types.ObjectId(socket.user_id) } },
                        {
                            $project: {
                                name: { $ifNull: ["$name", ""] },
                                number: 1,
                                country_code: 1,
                                profile_pic: {
                                    $cond: {
                                        if: { $eq: ["$profile_pic", ""] },
                                        then: "",
                                        else: {
                                            $concat: [
                                                process.env.SITE_URL,
                                                process.env.USER_PROFILE,
                                                "$profile_pic",
                                            ],
                                        }
                                    }
                                }
                            },
                        },
                    ]);

                    if (userData.length > 0) {
                        userData = userData[0];
                    } else {
                        userData = {};
                    }

                    socket.emit("ack_auth", {
                        user: userData,
                    });
                }
                catch (error) {
                    console.error("Error fetching auth data:", error);
                    socket.emit("ack_auth", {
                        error: "Failed to fetch auth data",
                    });
                }
            });

            socket.on("group_message", async ({ group_id, content }) => {
                try {
                    if (!mongoose.Types.ObjectId.isValid(group_id)) {
                        return socket.emit("ack_group_message", {
                            error: "Invalid group ID",
                        });
                    }

                    const group = await GroupModel.findById(group_id);
                    if (!group) {
                        return socket.emit("ack_group_message", {
                            error: "Group not found",
                        });
                    }

                    const isMember = await GroupMemberModel.exists({
                        group_id: group_id,
                        member: new mongoose.Types.ObjectId(socket.user_id),
                    });

                    if (!isMember) {
                        return socket.emit("ack_group_message", {
                            error: "You are not a member of this group",
                        });
                    }

                    const message = await GroupMessageModel.create({
                        group_id: new mongoose.Types.ObjectId(group_id),
                        user: new mongoose.Types.ObjectId(socket.user_id),
                        content: content
                    });

                    const payloadBase = {
                        _id: message._id,
                        group_id: group_id,
                        message: content,
                        date: message.createdAt,
                    }

                    socket.emit("ack_group_message", { ...payloadBase, isSelf: true });

                    socket.to(group_id.toString()).emit("ack_group_message", {
                        ...payloadBase,
                        is_self: false,
                    });

                    await GroupMemberModel.find({ group_id: group._id }).then(async (members) => {
                        for (const member of members) {
                            if (member.member.toString() !== socket.user_id) {
                                await UserChatStatusModel.findOneAndUpdate(
                                    { user_id: member.member, group_id: group._id },
                                    { last_msg_id: payloadBase._id },
                                    { upsert: true, new: true }
                                );
                            }
                        }
                    });

                } catch (error) {
                    console.error("Error sending group message:", error);
                    socket.emit("ack_group_message", {
                        error: "Failed to send group message",
                    });
                }
            });

            socket.on("disconnect", () => {
                console.log(`User ${socket.user_id} disconnected, socket ${socket.id}`);
                console.log("socket rooms", socket.rooms)
            });
        });

        return io;
    },
    getIO: () => {
        if (!io) {
            throw new Error("Socket.io not initialized!");
        }
        return io;
    },

};
