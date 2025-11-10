import { Router } from "express";
import {
  login,
  register,
  addToActivity,
  getAllActivity,
} from "../controllers/user.cotroller.js"; // ✅ correct spelling

const router = Router();

// ✅ Proper routes
router.post("/login", login);
router.post("/register", register);
router.post("/add_to_activity", addToActivity);
router.get("/get_all_activity", getAllActivity);

export default router;
