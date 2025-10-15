const fs = require("fs");
const moment = require("moment");
const path = require("path");
const logFolder = "./Logs/Error_log";
// const admin = require("firebase-admin");
// var serviceAccount = require("../../mythic-flash-446602-e3-firebase-adminsdk-ksowz-3a8f580600.json");
// const sharp = require("sharp");
// const LanguageModel = require("../models/languageModel");
// const LabelModel = require("../models/labelModel");

// // Generate otp and unique id for two factor authentication
exports.generateRandomString = (length = 6, isNumber = false) => {
  const characters = isNumber
    ? "0123456789"
    : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";

  if (isNumber) {
    result += "123456789".charAt(Math.floor(Math.random() * 9)); // First character cannot be '0'
  } else {
    result +=
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz123456789".charAt(
        Math.floor(Math.random() * characters.length - 1)
      );
  }

  for (let i = 0; i < length - 1; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }

  return result;
};

// exports.generateRandomAlphaNumericString = (length = 6) => {
//   const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
//   const digits = "0123456789";
//   const allChars = letters + digits;

//   if (length < 2) {
//     throw new Error("Length must be at least 2 to include both letter and digit.");
//   }

//   // Ensure at least one letter and one digit
//   let result = '';
//   result += letters.charAt(Math.floor(Math.random() * letters.length));
//   result += digits.charAt(Math.floor(Math.random() * digits.length));

//   // Fill remaining with random characters
//   for (let i = 2; i < length; i++) {
//     result += allChars.charAt(Math.floor(Math.random() * allChars.length));
//   }

//   // Shuffle the result to randomize letter/digit positions
//   result = result.split('').sort(() => 0.5 - Math.random()).join('');

//   return result;
// };

// // Getting the image url in case of no profile image for admin
// exports.getImageUrl = async (filename, name = "AD") => {
//   if (filename === "" || filename === undefined || filename === null) {
//     filename =
//       "https://ui-avatars.com/api/?name=" +
//       name +
//       "&rounded=true&background=c39a56&color=fff&format=png";
//   }
//   return filename;
// };

// error Logs
exports.writeErrorLog = async (req, error) => {
  try {
    if (!fs.existsSync(logFolder)) {
      fs.mkdirSync(logFolder, { recursive: true });
    }
  } catch (error) {
    console.log(error);
  }
  const requestURL = req.protocol + "://" + req.get("host") + req.originalUrl;
  const requestBody = JSON.stringify(req.body);
  const Method = req.method;
  const requestHeaders = JSON.stringify(req.headers);
  const date = moment().format("MMMM Do YYYY, h:mm:ss a");
  const file_date = moment().format("DDMMYYYY");

  const logEntry =
    "REQUEST DATE : " +
    date +
    "\n" +
    "API URL : " +
    requestURL +
    "\n" +
    "API METHOD : " +
    Method +
    "\n" +
    "API PARAMETER : " +
    requestBody +
    "\n" +
    "API Headers : " +
    requestHeaders +
    "\n" +
    "Error : " +
    error +
    "\n\n";

  // Append log entry to the file within the log folder
  const logFilePath = path.join(logFolder, `${file_date}_request.log`);
  fs.appendFileSync(logFilePath, logEntry);
};

// //push notifications
// exports.call_msg_notification = async (registration_ids, messages) => {
//   try {
//     // Loop through each registration_id and send the notification
//     for (const token of registration_ids) {
//       const message = {
//         // notification: {
//         //   title: messages.title,
//         //   body: messages.body,
//         //   // imageUrl: messages?.picture ? messages?.picture : "",
//         // },
//         token: token, // Send to one token at a time
//         android: {
//           priority: "high",
//           // notification: {
//           //   channel_id: "high_importance_channel",
//           //   // imageUrl: messages?.picture,
//           // },
//         },
//         data: {
//           title: messages.title,
//           body: messages.body,
//           notification_type: String(messages.type),
//           id: String(messages.id) ? String(messages.id) : "",
//           badge: String(messages?.badge),
//           // picture: messages?.picture ? messages?.picture : "",
//           // imageUrl: messages?.picture ? messages?.picture : "",
//           click_action: "FLUTTER_NOTIFICATION_CLICK",
//         },
//       };
//       // Send the message and wait for the result
//       const result = await admin.messaging().send(message);
//     }
//   } catch (err) {
//     console.error("Error sending notifications:", err);
//   }
// };

// exports.call_msg_ios_notification = async (registration_ids, messages) => {
//   try {
//     // Loop through each registration_id and send the notification
//     for (const token of registration_ids) {
//       let notification = {
//         title: messages.title,
//         body: messages.body,
//         // image: messages?.picture,
//       };
//       const message = {
//         notification: notification,
//         token: token, // Send to one token at a time
//         apns: {
//           payload: {
//             // headers: {
//             //   "apns-priority": "10",
//             // },
//             aps: {
//               alert: {
//                 title: messages.title,
//                 body: messages.body,
//               },
//               badge: messages?.badge,
//               sound: "default",
//               // "content-available": 1,
//             },
//             // image: messages?.picture,
//           },
//         },
//         data: {
//           title: messages?.title,
//           body: messages?.body,
//           notification_type: String(messages?.type),
//           badge: String(messages?.badge),
//           id: String(messages.id) ? String(messages.id) : "",
//           click_action: "FLUTTER_NOTIFICATION_CLICK",
//           // picture: messages?.picture ? messages?.picture : "",
//           // image: messages?.picture ? messages?.picture : "",
//         },
//       };

//       // Send the message and wait for the result
//       const result = await admin.messaging().send(message);
//     }
//   } catch (err) {
//     console.error("Error sending notifications:", err);
//   }
// };

//send push notification function
// exports.sendPushNotification = async (
//   to_user_id,
//   title,
//   body,
//   notification_id,
//   date,
//   badge_count
// ) => {
//   try {
//     let checkObj = {};
//     checkObj.user = new mongoose.Types.ObjectId(to_user_id);
//     let messageObject = {};
//     messageObject.type = notification_id && notification_id !== "" ? 1 : 2;
//     // 1 = admin_notification , 2 = user_notification (need to clarify)
//     messageObject.title = title;
//     messageObject.body = body;
//     messageObject.id = notification_id;
//     messageObject.date = date;
//     messageObject.badge = badge_count;

//     // const userTokens = await FCMDB.find({ user: to_user_id });
//     const android_list = new Array();
//     const ios_list = new Array();
//     userTokens.map((userToken) => {
//       if (userToken.type == 1) {
//         android_list.push(userToken.token);
//       }
//       if (userToken.type == 2) {
//         ios_list.push(userToken.token);
//       }
//     });
//     android_list.map(async (android_lists) => {
//       const registration_id = new Array();
//       registration_id.push(android_lists);
//       await exports.call_msg_notification(registration_id, messageObject);
//     });
//     ios_list.map(async (ios_lists) => {
//       const registration_id = new Array();
//       registration_id.push(ios_lists);
//       await exports.call_msg_ios_notification(registration_id, messageObject);
//     });
//   } catch (error) {
//     console.log(error, "error");
//   }
// };

//convert image to webp
// exports.convertToWebP = async (
//   filePath,
//   outputDir,
//   uploadthumb = "",
//   boolean
// ) => {
//   try {
//     if (!fs.existsSync(filePath)) {
//       throw new Error("File not found");
//     }

//     const originalFileName = path.basename(filePath);
//     const fileExt = path.extname(originalFileName)

//     // Thumbnail helper
//     const generateThumbnail = async (inputPath, outputName) => {
//       const thumbnailFilePath = path.join(uploadthumb, outputName);
//       await sharp(inputPath)
//         .resize(
//           parseInt(process.env.HEIGHT) || 150,
//           parseInt(process.env.WIDTH) || 150,
//           {
//             fit: sharp.fit.cover,
//             position: sharp.strategy.entropy,
//           }
//         )
//         .toFile(thumbnailFilePath);
//     };

//     // If file is already webp, skip conversion but maybe create a thumbnail
//     if (fileExt === ".webp") {
//       if (boolean && uploadthumb) {
//         await generateThumbnail(filePath, originalFileName);
//       }
//       return originalFileName;
//     }

//     // Convert to WebP
//     const webpFileName = originalFileName.replace(fileExt, ".webp");
//     const webpFilePath = path.join(outputDir, webpFileName);

//     await sharp(filePath).webp({ quality: 80 }).toFile(webpFilePath);

//     // Create thumbnail if requested
//     if (boolean && uploadthumb) {
//       await generateThumbnail(webpFilePath, webpFileName);
//     }

//     fs.unlinkSync(filePath); // Delete original

//     return webpFileName;
//   } catch (error) {
//     console.error("Error converting image to WebP:", error);
//     throw error;
//   }
// };

// exports.getTranslatedResponse = async (label, language = "en") => {
//   try {
//     if (language !== "en") {
//       let languageCheck = await LanguageModel.findOne({
//         language_code: language,
//       });
//       if (!languageCheck) {
//         language = "en";
//       }
//     }

//     let listLabel = await LabelModel.find({});
//     for (let index = 0; index < listLabel.length; index++) {
//       const element = listLabel[index];
//       if (element.index == label) {
//         return element[language];
//       }
//     }
//     return "";
//   } catch (error) {
//     console.log(error);
//   }
// };
