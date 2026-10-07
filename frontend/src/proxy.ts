import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: {
    signIn: "/auth/login",
  },
  secret: process.env.NEXTAUTH_SECRET || "fallback-secret-for-demo",
});

export const config = {
  matcher: [
    "/checkout/:path*",
  ],
};
