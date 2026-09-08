type DisplayNameUser = {
  email?: string | null;
  username?: string | null;
  user_metadata?: {
    username?: unknown;
  } | null;
};

export function getDisplayName(
  user: DisplayNameUser | null | undefined,
  fallback = "Unknown user",
) {
  const metadataUsername = user?.user_metadata?.username;
  if (typeof metadataUsername === "string" && metadataUsername.trim()) {
    return metadataUsername.trim();
  }

  if (typeof user?.username === "string" && user.username.trim()) {
    return user.username.trim();
  }

  if (typeof user?.email === "string" && user.email.trim()) {
    return user.email.split("@", 1)[0];
  }

  return fallback;
}