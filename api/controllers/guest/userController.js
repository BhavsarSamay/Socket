const UserModel = require("../../models/userModel");
const jwt = require("jsonwebtoken");
const Helper = require("../../helper/helper");
const LoginVerificationModel = require("../../models/verification_model");

exports.send_otp = async (req, res, next) => {
    try {
        let { number, country_code, resend } = req.body;

        await new LoginVerificationModel({
            number: number,
            otp: "123456",
            country_code: country_code
        }).save();

        message = "otp sent successfully";

        if (resend == 2) {
            message = "otp resent successfully"; s
        }

        return res.status(200).json({
            message: message
        });
    } catch (error) {
        next(error);
    }
};

exports.login = async (req, res, next) => {
    try {
        let { number, otp, country_code } = req.body;

        let check_token = await LoginVerificationModel.findOne({
            number: number,
            country_code: country_code,
            otp: otp,
        });

        if (check_token) {
            let opManager_data = await UserModel.findOne({
                number: number,
                country_code: country_code,
            });

            if (opManager_data) {
                if (opManager_data.status != 1) {
                    return res.status(409).json({
                        message: "account inactive please contact administrator",
                    });
                }

                // JWT token generate
                const jwt_token = jwt.sign(
                    {
                        number: opManager_data.number,
                        country_code: opManager_data.country_code,
                        id: opManager_data._id,
                        version: opManager_data.version,
                    },
                    process.env.JWT_KEY,
                    {
                        expiresIn: "10d",
                    }
                );

                await LoginVerificationModel.deleteOne({ _id: check_token._id });

                return res.status(200).json({
                    message: "login successful",
                    token: jwt_token,
                });
            } else {
                let userObj = {}

                userObj.number = number;
                userObj.country_code = country_code;

                let user = await UserModel(userObj).save();

                const jwt_token = jwt.sign(
                    {
                        number: user.number,
                        country_code: user.country_code,
                        id: user._id,
                        version: user.version,
                    },
                    process.env.JWT_KEY,
                    {
                        expiresIn: "10d",
                    }
                );

                await LoginVerificationModel.deleteOne({ _id: check_token._id });

                return res.status(200).json({
                    message: "login successful",
                    token: jwt_token,
                });
                
            }
        } else {
            return res.status(409).json({
                message: "Invalid OTP"
            });
        }
    } catch (error) {
        next(error);
    }
};
