import {AuthForm} from "@/modules/auth/form";
export default async function Reset({searchParams}:{searchParams:Promise<{token?:string}>}){const {token}=await searchParams;return <AuthForm mode="reset" token={token}/>;}
