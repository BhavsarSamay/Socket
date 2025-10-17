const socketIO = require("socket.io");
const { default: mongoose, mongo } = require("mongoose");
const jwt = require("jsonwebtoken");
const MessageModel = require("./api/models2/MessageModel");
const GroupMessageModel = require("./api/models2/GroupMessageModel");
const GroupModel = require("./api/models2/GroupModel");
const GroupMemberModel = require("./api/models2/GroupMemberModel");
const UserChatStatusModel = require("./api/models2/ChatCountModel");

const UserModel = require("./api/models/userModel");

let onlineUsers = new Map();
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
                                    { from: new mongoose.Types.ObjectId(socket.user_id), to: new mongoose.Types.ObjectId(user_id) },
                                    { from: new mongoose.Types.ObjectId(user_id), to: new mongoose.Types.ObjectId(socket.user_id) }
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
                                isSelf: {
                                    $cond: {
                                        if: { $eq: ["$from", new mongoose.Types.ObjectId(socket.user_id)] },
                                        then: true,
                                        else: false
                                    }
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
                console.log(error)
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
            // console.log("Socket Rooms", socket.rooms)
            // console.log("Logging io", io.sockets.adapter.sids)
            // console.log("After Join", socket)


            let sockets = onlineUsers.get(socket.user_id) || new Set();
            sockets.add(socket.id);
            onlineUsers.set(socket.user_id, sockets);


            socket.on("group_open", async ({ group_id }) => {
                socket.chat_with = group_id?.toString();
                await group_history(socket, group_id);
                // get_paginated_chat_history(socket, { group_id });
            });

            socket.on("chat_open", async ({ to_user }) => {
                socket.chat_with = to_user?.toString();
                console.log("socket chat", socket.chat_with)
                await chat_history(socket, to_user)
            });

            socket.on("message", async ({ to, content }) => {
                io.to(to).emit("ack_message", content);

                console.log("reached")
                console.log("Message received:", to, content);
                try {

                    if (!mongoose.Types.ObjectId.isValid(to)) {
                        return socket.emit("ack_message", {
                            error: "Invalid User ID",
                        });
                    }

                    const user = await UserModel.findById(to);
                    if (!user) {
                        return socket.emit("ack_message", {
                            error: "User not found",
                        });
                    }

                    const messageObj= send_message()
                    const message = await MessageModel.create({
                        from: socket.user_id,
                        to: new mongoose.Types.ObjectId(to),
                        content: content
                    });

                    const payloadBase = {
                        _id: message._id,
                        sender: socket.user_id,
                        receiver: to,
                        content: message.content
                    }


                    const socketIds = onlineUsers.get(to) || new Set();
                    console.log(socketIds, "Socket IDs")

                    for (const socketId of socketIds) {
                        const receiverSocket = io.sockets.sockets.get(socketId);
                        if (receiverSocket?.connected) {
                            const isSelf = socketId === socket.user_id;
                            const isChatOpen = receiverSocket.chat_with === socket.user_id.toString();
                            console.log(receiverSocket.chat_with, socket.user_id.toString())
                            console.log("is Chat Open", isChatOpen)
                            // receiverSocket.emit("ack_message", {
                            //     message: content,
                            //     sender: socket.user_id,
                            //     receiver: to
                            // });
                            // if (isChatOpen && socketId !== socket.id) {
                            //     receiverSocket.emit("ack_message", {
                            //         ...payloadBase,
                            //         is_self: isSelf,
                            //     });
                            if (socketId !== socket.id) {

                                receiverSocket.emit("ack_message", {
                                    ...payloadBase,
                                    is_self: isSelf,
                                });

                                // Update last_msg_id only for recipients
                                if (!isSelf) {
                                    await UserChatStatusModel.findOneAndUpdate(
                                        {
                                            user_id: new mongoose.Types.ObjectId(to),
                                            to_user: socket.user_id,
                                        },
                                        {
                                            last_msg_id: payloadBase._id,
                                        },
                                        {
                                            upsert: true,
                                            new: true,
                                        }
                                    );
                                }
                            }
                        }
                    }
                }
                catch (error) {
                    console.error("Error sending message:", error);
                    socket.emit("ack_message", {
                        error: "Failed to send message",
                    });
                }

            });

            socket.on("chat_history", async ({ user_id }) => {
                try {
                    await chat_history(socket, user_id);
                } catch (err) {
                    socket.emit("ack_chat_history", {
                        error: "Failed to fetch chat history",
                    });
                }
            });

            socket.on("group_history", async ({ group_id }) => {
                try {
                    console.log("Group id", group_id)
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

                    await group_history(socket, group_id);
                }
                catch (err) {
                    console.error("Error fetching group history:", err);
                    socket.emit("ack_group_history", {
                        error: "Failed to fetch group history",
                    });
                }
            });

            socket.on("update_profile", async ({ name, number, country_code, profile_picture }) => {
                try {
                    if (!mongoose.Types.ObjectId.isValid(socket.user_id)) {
                        return socket.emit("ack_update_profile", {
                            error: "Invalid user id",
                        });
                    }

                    let updateData = {};

                    if (name) updateData.name = name.trim();
                    if (number) {
                        const checkNumber = await UserModel.findOne({
                            _id: { $ne: new mongoose.Types.ObjectId(socket.user_id) },
                            number: number.trim(),
                        });
                        if (checkNumber) {
                            return socket.emit("ack_update_profile", {
                                error: "Number already exists",
                            });
                        }
                        updateData.number = number.trim();
                    }
                    if (country_code) updateData.country_code = country_code.trim();
                    if (profile_picture) updateData.profile_picture = profile_picture.trim();


                    const updatedUser = await UserModel.findByIdAndUpdate(
                        socket.user_id,
                        updateData,
                        { new: true }
                    );

                    if (!updatedUser) {
                        return socket.emit("ack_update_profile", {
                            error: "User not found",
                        });
                    }

                    socket.user = updatedUser; // Update the socket user data
                    socket.emit("ack_update_profile", {
                        message: "Profile updated successfully",
                        user: updatedUser
                    });

                } catch (error) {
                    console.error("Error updating profile:", error);
                    socket.emit("ack_update_profile", {
                        error: "Failed to update profile",
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

            socket.on("create_group", async ({ name, members }) => {
                try {
                    const userId = socket.user_id;

                    console.log(name)
                    console.log(members)

                    if (!name || !members || typeof members !== "string" || members.trim() === "") {
                        return socket.emit("ack_create_group", {
                            error: "Group name and members (comma-separated string) are required.",
                        });
                    }

                    let memberIds = members
                        .split(",")
                        .map(id => id.trim())
                        .filter(id => mongoose.Types.ObjectId.isValid(id));

                    if (!memberIds.includes(userId.toString())) {
                        memberIds.push(userId.toString());
                    }

                    memberIds = [...new Set(memberIds)];

                    const memberObjectIds = memberIds.map(id => new mongoose.Types.ObjectId(id));

                    const existingGroup = await GroupModel.findOne({
                        $expr: {
                            $eq: [{ $toLower: "$name" }, name.trim().toLowerCase()],
                        },
                    });

                    if (existingGroup) {
                        return socket.emit("ack_create_group", {
                            error: "Group name already exists.",
                        });
                    }

                    const group = await GroupModel.create({ name: name.trim() });

                    const groupMembers = memberObjectIds.map(memberId => ({
                        group_id: group._id,
                        member: memberId,
                    }));

                    await GroupMemberModel.insertMany(groupMembers);

                    socket.emit("ack_create_group", {
                        message: "Group created successfully.",
                        group_id: group._id,
                    });



                    for (const memberId of memberObjectIds) {
                        if (memberId.toString() === userId.toString()) continue;

                        const socketIds = onlineUsers.get(memberId.toString()) || new Set();

                        for (const socketId of socketIds) {
                            const memberSocket = io.sockets.sockets.get(socketId);
                            if (memberSocket && memberSocket.connected) {
                                console.log(`Inviting member ${memberId} to group ${group._id}`);
                                memberSocket.emit("group_invite", {
                                    group_id: group._id,
                                    group_name: name.trim(),
                                });
                            }
                        }
                    }
                } catch (error) {
                    console.error("Error creating group:", error);
                    socket.emit("ack_create_group", {
                        error: "Failed to create group",
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

                    // socket.emit("ack_group_message", { ...payloadBase, isSelf: true });

                    const groupMembers = await GroupMemberModel.find({ group_id: group._id });
                    
                    for (const member of groupMembers) {
                        const memberId = member.member.toString();
                        // const memberSocketIds = onlineUsers.get(member.member.toString()) || new Set();
                        for (const socketId of memberSocketIds) {

                            const memberSocket = io.sockets.sockets.get(socketId);
                            if (memberSocket?.connected) {
                                const isSelf = memberId === socket.user_id;
                                const isChatOpen =
                                    memberSocket.chat_with === group._id.toString();

                                // console.log("Member Socket", memberSocket)

                                if (isChatOpen && socketId !== socket.id) {
                                    memberSocket.emit("ack_group_message", {
                                        ...payloadBase,
                                        is_self: isSelf,
                                    });

                                    // Update last_msg_id only for recipients
                                    if (!isSelf) {
                                        await UserChatStatusModel.findOneAndUpdate(
                                            {
                                                user_id: member.member,
                                                group_id: group._id,
                                            },
                                            {
                                                last_msg_id: payloadBase._id,
                                            },
                                            {
                                                upsert: true,
                                                new: true,
                                            }
                                        );
                                    }
                                }
                            }
                            // if (memberSocket && memberSocket.connected && socketId !== socket.id) {


                            //     // memberSocket.emit("ack_group_message", {
                            //     //     message: content,
                            //     //     sender: socket.user_id,
                            //     //     group_id: group._id.toString(),
                            //     //     group_name: group.name,
                            //     // });
                            //     memberSocket.emit("ack_group_message", {
                            //         ...payloadBase,
                            //         is_self: isSelf
                            //     });
                            // }
                            // if (memberSocket && memberSocket.connected) {

                            //     console.log("memberSocket", memberSocket.chat_with)
                            //     const isSelf = memberId === socket.user_id;
                            //     // const isChatOpen =
                            //     //     memberSocket.chat_with === group._id.toString();

                            //     if (socketId !== socket.id) {
                            //         memberSocket.emit("ack_group_message", {
                            //             ...payloadBase,
                            //             is_self: isSelf,
                            //         });
                            //     }
                            // }
                        }
                    }
                } catch (error) {
                    console.error("Error sending group message:", error);
                    socket.emit("ack_group_message", {
                        error: "Failed to send group message",
                    });
                }
            });

            socket.on("get_side_list", async () => {
                try {

                    let users = await UserModel.aggregate([
                        {
                            $match: {
                                _id: { $ne: new mongoose.Types.ObjectId(socket.user_id) },
                                status: 1
                            }
                        },
                        {
                            $project: {
                                ref_id: "$_id",
                                name: { $ifNull: ["$name", ""] },
                                number: { $ifNull: ["$number", ""] },
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
                                },
                                type: { $literal: 1 }
                            }
                        }
                    ])

                    let groups = await GroupMemberModel.aggregate([
                        {
                            $match: {
                                member: new mongoose.Types.ObjectId(socket.user_id)
                            }
                        },
                        {
                            $lookup: {
                                from: "groups",
                                localField: "group_id",
                                foreignField: "_id",
                                as: "groupData",
                                pipeline: [
                                    {
                                        $match: {
                                            status: 1
                                        }
                                    }
                                ]
                            }
                        },
                        {
                            $unwind:
                            {
                                path: "$groupData",
                                preserveNullAndEmptyArrays: false
                            }
                        },
                        {
                            $project:
                            {
                                name: "$groupData.name",
                                group_id: "$group_id",
                                type: { $literal: 2 }
                            }
                        }
                    ])
                    users = users.concat(groups);

                    socket.emit("ack_side_list", { side_list: users });
                }
                catch (error) {
                    console.error("Error fetching members:", error);
                    socket.emit("ack_members", {
                        error: "Failed to fetch members",
                    });
                }
            });

            socket.on("disconnect", () => {
                for (const [userId, socketIds] of onlineUsers.entries()) {
                    if (socketIds.has(socket.id)) {
                        socketIds.delete(socket.id);
                        if (socketIds.size === 0) {
                            onlineUsers.delete(userId);
                        } else {
                            onlineUsers.set(userId, socketIds);
                        }
                        break;
                    }
                }
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

// socket.on("message", async (to, content) => {
//     console.log("Message received:", to, content);
//     const socketIds = onlineUsers.get(to) || new Set();

//     for (const socketId of socketIds) {
//         const receiverSocket = io.sockets.sockets.get(socketId);
//         if (receiverSocket?.connected && socketId !== socket.id) {
//             receiverSocket.emit("ack_message", {
//                 message: content,
//                 sender: socket.user_id,
//                 receiver: to
//             });
//         }
//     }
// })

// socket.on("message", async ({ message1, message2 }) => {
//     console.log({ message1, message2 });
//     console.log("Message received:", message1, message2);
//     socket.emit("message", {
//         message1,
//         message2
//     });
// })
// socket.on("message", async (content) => {
//     let user1 = "6877514613237b5560bed860"
//     let user2 = "68777d3daede6b2b9f965d0e"

//     let receiver = ""

//     if (socket.user_id == user1) {
//         receiver = user2
//     }
//     else {
//         receiver = user1
//     }

//     const socketIds = onlineUsers.get(receiver) || new Set();

//     for (const socketId of socketIds) {
//         const receiverSocket = io.sockets.sockets.get(socketId);
//         if (receiverSocket?.connected) {

//             if (socketId !== socket.id) {
//                 receiverSocket.emit("message", {
//                     message: content,
//                     sender: socket.user_id,
//                     receiver: receiver
//                 });
//             }
//         }
//     }
// })
