import { Router, type IRouter } from "express";
import healthRouter from "./health";
import earthRouter from "./earth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(earthRouter);

export default router;
