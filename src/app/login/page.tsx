import {AuthForm} from "@/modules/auth/form";
export default function Login(){return <AuthForm mode="login" google={Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET)}/>;}
