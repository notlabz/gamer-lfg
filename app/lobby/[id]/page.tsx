"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useParams, useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";

type Lobby = {
  id: string;
  game_title?: string;
  lobby_name?: string;
  game_mode?: string;
  current_players?: number;
  max_players?: number;
  platform?: string;
  mic_required?: boolean;
  discord?: string;
  host_id?: string;
  member_ids?: string[];
};

type Profile = {
  id: string;
  email?: string;
  username?: string;
  display_name?: string;
};

type LobbyMessage = {
  id: string;
  lobby_id: string;
  user_id: string;
  user_email?: string;
  message: string;
  created_at: string;
};

const supabase = createClient();

function displayName(profile: Profile | undefined, userId: string) {
  return profile?.display_name || profile?.username || profile?.email || userId;
}

function getDiscordUrl(input: string) {
  const value = input.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(?:discord\.gg|discord\.com)\//i.test(value)) {
    return `https://${value}`;
  }
  return `https://discord.com/users/${encodeURIComponent(value)}`;
}

async function handleDiscordClick(discordInput: string, notify: (message: string) => void) {
  const value = discordInput.trim();
  if (!value) return;

  const isInvite = /discord\.gg|discord\.com\/invite|^https?:\/\//i.test(value);
  if (isInvite) {
    window.open(getDiscordUrl(value) ?? value, "_blank");
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    notify(`Copied Discord username '${value}' to clipboard!`);
    window.open("https://discord.com/channels/@me", "_blank");
  } catch (copyError) {
    notify(copyError instanceof Error ? copyError.message : JSON.stringify(copyError));
  }
}

function renderMessageContent(content: string): ReactNode[] {
  const parts = content.split(/(https?:\/\/[^\s]+)/g);
  const rendered: ReactNode[] = [];

  parts.forEach((part, index) => {
    if (!part) return;
    if (!/^https?:\/\//i.test(part)) {
      rendered.push(<span key={`text-${index}`}>{part}</span>);
      return;
    }

    const rawUrl = part;
    const cleanUrl = rawUrl.replace(/[.,!?;:)\]]+$/, "");
    const trailingText = rawUrl.slice(cleanUrl.length);
    const isImage =
      /\.(png|jpe?g|gif|webp)(?:[?#].*)?$/i.test(cleanUrl) ||
      /(?:giphy\.com|tenor\.com)/i.test(cleanUrl);

    rendered.push(
      isImage ? (
        <span className="my-2 block" key={`image-${index}`}>
          <a href={cleanUrl} rel="noreferrer" target="_blank">
            <img
              alt="Shared chat attachment"
              className="max-h-72 max-w-full rounded-lg object-contain"
              loading="lazy"
              src={cleanUrl}
            />
          </a>
        </span>
      ) : (
        <a
          className="text-emerald-400 underline hover:text-emerald-300"
          href={cleanUrl}
          key={`link-${index}`}
          rel="noreferrer"
          target="_blank"
        >
          {cleanUrl}
        </a>
      ),
    );
    if (trailingText) rendered.push(<span key={`trailing-${index}`}>{trailingText}</span>);
  });

  return rendered;
}

export default function SquadPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [messages, setMessages] = useState<LobbyMessage[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentPreviews, setAttachmentPreviews] = useState<
    { file: File; url: string }[]
  >([]);
  const [discordNotice, setDiscordNotice] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSquad() {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        router.replace("/");
        return;
      }

      const { data: lobbyData, error: lobbyError } = await supabase
        .from("lobbies")
        .select("*")
        .eq("id", id)
        .single();

      if (lobbyError || !lobbyData) {
        if (isMounted) {
          setError(lobbyError?.message ?? "Lobby not found.");
          setLoading(false);
        }
        return;
      }

      const lobbyRecord = lobbyData as Lobby;
      const memberIds = Array.from(
        new Set([lobbyRecord.host_id, ...(lobbyRecord.member_ids ?? [])].filter(Boolean)),
      ) as string[];
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .in("id", memberIds);

      const { data: messageData, error: messageError } = await supabase
        .from("lobby_messages")
        .select("*")
        .eq("lobby_id", id)
        .order("created_at", { ascending: true });

      if (!isMounted) return;

      setUser(userData.user);
      setLobby(lobbyRecord);
      setProfiles((profileData ?? []) as Profile[]);
      setMessages((messageData ?? []) as LobbyMessage[]);
      setError(
        profileError?.message ?? messageError?.message ?? null,
      );
      setLoading(false);
    }

    void loadSquad();
    return () => {
      isMounted = false;
    };
  }, [id, router]);

  useEffect(() => {
    if (!params.id) return;

    const channel = supabase
      .channel(`room-${params.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "lobby_messages",
          filter: `lobby_id=eq.${params.id}`,
        },
        (payload) => {
          const newMsg = payload.new as LobbyMessage;
          setMessages((prev) => {
            if (prev.some((message) => message.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        },
      )
      .subscribe((status) => {
        console.log("Realtime status:", status);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [params.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !id || (!messageInput.trim() && attachments.length === 0)) return;

    setSending(true);
    setIsUploading(attachments.length > 0);
    setError(null);

    try {
      const attachmentUrls: string[] = [];
      for (const file of attachments) {
        const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        const filePath = `${id}/${crypto.randomUUID()}-${safeFileName}`;
        const { error: uploadError } = await supabase.storage
          .from("chat-attachments")
          .upload(filePath, file, { cacheControl: "3600", upsert: false });
        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from("chat-attachments")
          .getPublicUrl(filePath);
        attachmentUrls.push(publicUrlData.publicUrl);
      }

      const messageText = [messageInput.trim(), ...attachmentUrls]
        .filter(Boolean)
        .join("\n");
      const { error: sendError } = await supabase.from("lobby_messages").insert({
        lobby_id: id,
        user_id: user.id,
        user_email: user.email,
        message: messageText,
      });

      if (sendError) throw sendError;
      setMessageInput("");
      setAttachments([]);
      attachmentPreviews.forEach((preview) => URL.revokeObjectURL(preview.url));
      setAttachmentPreviews([]);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : JSON.stringify(sendError));
    } finally {
      setIsUploading(false);
      setSending(false);
    }
  }

  function addAttachmentFiles(files: File[]) {
    const filesToAdd = files.filter((file) =>
      file.type.startsWith("image/"),
    );
    setAttachments((previous) => [...previous, ...filesToAdd]);
    setAttachmentPreviews((previous) => [
      ...previous,
      ...filesToAdd.map((file) => ({ file, url: URL.createObjectURL(file) })),
    ]);
  }

  function handleFileChange(newFiles: FileList | null) {
    if (!newFiles) return;
    addAttachmentFiles(Array.from(newFiles));
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    handleFileChange(event.target.files);
    event.target.value = "";
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    for (const item of Array.from(event.clipboardData.items)) {
      if (!item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (!file) continue;
      event.preventDefault();
      addAttachmentFiles([file]);
      return;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  if (loading) {
    return <main className="min-h-screen bg-zinc-950 p-8 text-zinc-400">Loading squad...</main>;
  }

  if (!lobby) {
    return (
      <main className="min-h-screen bg-zinc-950 p-8 text-red-400">
        {error ?? "Lobby not found."}
      </main>
    );
  }

  const memberIds = Array.from(
    new Set([lobby.host_id, ...(lobby.member_ids ?? [])].filter(Boolean)),
  ) as string[];

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-100 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <button
          className="mb-8 text-sm text-zinc-400 hover:text-white"
          onClick={() => router.push("/")}
          type="button"
        >
          Back to lobbies
        </button>
        <header className="mb-8 border-b border-zinc-800 pb-6">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">
            {lobby.game_title ?? "Squad room"}
          </p>
          <h1 className="mt-2 text-4xl font-semibold">{lobby.lobby_name}</h1>
          <p className="mt-3 text-zinc-400">
            {lobby.game_mode} · {Number(lobby.current_players ?? 0)} / {Number(lobby.max_players ?? 0)} players
          </p>
        </header>

        {error && <p className="mb-6 text-sm text-red-400">{error}</p>}
        <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <section className="border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="text-lg font-semibold">Teammates</h2>
            <ul className="mt-4 space-y-3">
              {memberIds.map((memberId) => (
                <li className="flex items-center justify-between border-b border-zinc-800 pb-3 text-sm" key={memberId}>
                  <span>{displayName(profiles.find((profile) => profile.id === memberId), memberId)}</span>
                  <span className="text-xs text-emerald-400">
                    {memberId === lobby.host_id ? "Host" : "Member"}
                  </span>
                </li>
              ))}
            </ul>
            <dl className="mt-8 space-y-3 border-t border-zinc-800 pt-5 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-zinc-500">Voice</dt><dd>{lobby.mic_required ? "Mic required" : "Mic optional"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-zinc-500">Discord</dt><dd className="max-w-[65%] truncate text-right">{lobby.discord ?? "Not provided"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-zinc-500">Platform</dt><dd>{lobby.platform ?? "Any"}</dd></div>
            </dl>
            {lobby.discord ? (
              <button
                className="mt-6 block bg-[#5865F2] px-4 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-[#4752c4]"
                onClick={() =>
                  void handleDiscordClick(lobby.discord ?? "", setDiscordNotice)
                }
                type="button"
              >
                {/discord\.gg|discord\.com\/invite|^https?:\/\//i.test(lobby.discord)
                  ? "Join Discord Server"
                  : `Copy Discord Tag (${lobby.discord})`}
              </button>
            ) : (
              <span className="mt-6 block border border-zinc-700 px-4 py-3 text-center text-sm text-zinc-500">
                No Discord Provided
              </span>
            )}
            {discordNotice && (
              <p className="mt-3 text-sm text-emerald-300" role="status">
                {discordNotice}
              </p>
            )}
          </section>

          <section className="flex h-[calc(100vh-250px)] min-h-[500px] max-h-[700px] flex-col border border-zinc-800 bg-zinc-900 p-5">
            <div className="shrink-0">
              <h2 className="text-lg font-semibold">Squad Chat</h2>
              <p className="mt-1 text-sm text-zinc-500">Coordinate your next match.</p>
            </div>
            <div className="mt-5 min-h-0 flex-1 space-y-3 overflow-y-auto border-y border-zinc-800 px-1 py-4 [scrollbar-color:#52525b_#18181b] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-600 [&::-webkit-scrollbar-track]:bg-zinc-950">
              {messages.length === 0 && <p className="text-sm text-zinc-500">No messages yet.</p>}
              {messages.map((chatMessage) => (
                <article className="border border-zinc-800 bg-zinc-950 p-3" key={chatMessage.id}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-xs text-emerald-400">
                      {chatMessage.user_email ||
                        displayName(
                          profiles.find((profile) => profile.id === chatMessage.user_id),
                          chatMessage.user_id,
                        )}
                    </p>
                    <time
                      className="shrink-0 text-[11px] text-zinc-500"
                      dateTime={chatMessage.created_at}
                    >
                      {new Date(chatMessage.created_at).toLocaleString()}
                    </time>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">
                    {renderMessageContent(chatMessage.message)}
                  </div>
                </article>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <form className="mt-4 flex shrink-0 gap-3" onSubmit={handleSendMessage}>
              <input
                accept="image/*,.gif"
                className="hidden"
                onChange={handleFileInputChange}
                ref={fileInputRef}
                type="file"
              />
              <div className="min-w-0 flex-1">
                {attachmentPreviews.length > 0 && (
                  <div className="mb-2 flex gap-2 overflow-x-auto">
                    {attachmentPreviews.map((preview) => (
                      <div className="relative shrink-0" key={`${preview.file.name}-${preview.file.lastModified}`}>
                        <img
                          alt={`Preview of ${preview.file.name}`}
                          className="h-16 w-16 rounded object-cover"
                          src={preview.url}
                        />
                        <button
                          aria-label={`Remove ${preview.file.name}`}
                          className="absolute right-0 top-0 bg-zinc-950/80 px-1 text-xs text-white"
                          onClick={() =>
                            (() => {
                              URL.revokeObjectURL(preview.url);
                              setAttachments((current) =>
                                current.filter((file) => file !== preview.file),
                              );
                              setAttachmentPreviews((current) =>
                                current.filter((item) => item.file !== preview.file),
                              );
                            })()
                          }
                          type="button"
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  className="min-h-11 w-full resize-none border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-white outline-none focus:border-emerald-400"
                  onChange={(event) => setMessageInput(event.target.value || "")}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder="Message your squad"
                  rows={1}
                  value={messageInput}
                />
              </div>
              <button
                aria-label="Attach image or GIF"
                className="border border-zinc-700 px-3 text-lg text-zinc-300 transition-colors hover:border-emerald-400 hover:text-emerald-400 disabled:cursor-wait disabled:opacity-50"
                disabled={isUploading || sending}
                onClick={() => fileInputRef.current?.click()}
                title={isUploading ? "Uploading attachment" : "Attach image or GIF"}
                type="button"
              >
                {isUploading ? "..." : "Attach"}
              </button>
              <button className="bg-emerald-400 px-4 py-3 text-sm font-semibold text-zinc-950 disabled:opacity-50" disabled={sending || isUploading || (!messageInput.trim() && attachments.length === 0)} type="submit">
                {sending ? "Sending..." : "Send"}
              </button>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
