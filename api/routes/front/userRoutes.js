const express = require("express");
const frontRouter = express.Router();
const UserController = require("../../controllers/front/userController");
const UserCheckAuth = require("../../middleware/userMiddleware");
const folderPath = "./uploads/user/";
const multer = require("multer");
const fs = require("fs");
const helper = require("../../helper/helper");


try {
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }
} catch (error) {
    console.log(error);
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, folderPath);
    },
    filename: function (req, file, cb) {
        const sanitizedFileName =
            helper.generateRandomString(5) +
            "-" +
            sanitizeFileName(file.originalname);
        cb(null, sanitizedFileName);
    },
});

const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = [
        "image/png",
        "image/jpg",
        "image/jpeg",
        "image/gif",
        "image/svg+xml",
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(
            new Error("Only .png, .jpg, .gif, and .jpeg formats are allowed!"),
            false
        );
    }
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 1024 * 1024 * 10,
    },
    fileFilter: fileFilter,
});

const sanitizeFileName = (filename) => {
    return filename.replace(/[^a-zA-Z0-9.]/g, "_"); // Replace unwanted characters
};


frontRouter.get(
    "/auth",
    UserCheckAuth,
    UserController.auth
);

frontRouter.post(
    "/update_profile",
    UserCheckAuth,
    upload.single("profile_pic"),
    UserController.update_profile
);

frontRouter.post(
    "/upload",
    UserCheckAuth,
    upload.single("image"),
    UserController.upload
);


module.exports = frontRouter;