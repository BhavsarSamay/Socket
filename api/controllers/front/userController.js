const UserModel = require("../../models/userModel");
const mongoose = require("mongoose");

exports.auth = async (req, res, next) => {
    try {
        const id = req.userData._id;
        let userData = await UserModel.aggregate([
            { $match: { _id: id } },
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

        return res.status(200).json({
            message: "ok",
            result: userData,
        });
    } catch (error) {
        next(error);
    }
};

exports.update_profile = async (req, res, next) => {
    try {
        const id = req.userData._id;
        const { name, number, country_code } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                message: "Invalid user id",
            });
        }

        const checkUser = await UserModel.findOne(
            {
                _id: id,
                status: 1
            }
        );

        if (!checkUser) {
            return res.status(404).json({
                message: "User not found or inactive",
            });
        }

        let updateData = {};

        if (name) updateData.name = name;
        if (number) updateData.number = number;
        if (country_code) updateData.country_code = country_code;

        if (req.file) {
            updateData.profile_pic = req.file.filename;
        }

        const updatedUser = await UserModel.findByIdAndUpdate(id, updateData, {
            new: true,
        });

        return res.status(200).json({
            message: "Profile updated successfully",
            result: updatedUser,
        });

    }
    catch (error) {
        next(error);
    }
}

exports.upload = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                message: "No file uploaded",
            });
        }

        return res.status(200).json({
            message: "File uploaded successfully",
            file: req.file.filename,
        });
    }
    catch (error) {
        next(error);
    }
}