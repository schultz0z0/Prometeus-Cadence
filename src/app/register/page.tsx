import { AuthForm } from "@/modules/auth/form";
export default function Register() {
  return (
    <AuthForm
      mode="register"
      google={Boolean(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
      )}
    />
  );
}
