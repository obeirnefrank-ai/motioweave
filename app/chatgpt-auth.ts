import { headers } from "next/headers";

export type ChatGPTUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  // Allow overriding via header for testing, otherwise default to admin
  const email = requestHeaders.get("x-admin-email") ?? "obeirnefrank@gmail.com";
  const userId = requestHeaders.get("x-admin-user-id") ?? "admin";
  const fullName = requestHeaders.get("x-admin-name") ?? "Admin User";
  return {
    userId,
    displayName: fullName ?? email,
    email,
    fullName,
  };
}

export async function requireChatGPTUser(): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (!user) throw new Error("Admin user not available");
  return user;
}

export function chatGPTSignInPath(returnTo: string): string {
  return returnTo.startsWith("/") ? returnTo : "/";
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  return returnTo.startsWith("/") ? returnTo : "/";
}
