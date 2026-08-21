"use client";

import { useEffect, useState, type FormEvent } from "react";
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
  discord_tag?: string;
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

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !id || !messageInput.trim()) return;

    const messageText = messageInput.trim();

    setSending(true);
    setError(null);

    const { error: sendError } = await supabase.from("lobby_messages").insert({
      lobby_id: id,
      user_id: user.id,
      user_email: user.email,
      message: messageText,
    });

    if (sendError) {
      setError(sendError.message);
      setSending(false);
      return;
    }

    setMessageInput("");
    setSending(false);
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
              <div className="flex justify-between gap-4"><dt className="text-zinc-500">Discord</dt><dd className="max-w-[65%] truncate text-right">{lobby.discord_tag ?? "Not provided"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-zinc-500">Platform</dt><dd>{lobby.platform ?? "Any"}</dd></div>
            </dl>
          </section>

          <section className="flex min-h-[520px] flex-col border border-zinc-800 bg-zinc-900 p-5">
            <div>
              <h2 className="text-lg font-semibold">Squad Chat</h2>
              <p className="mt-1 text-sm text-zinc-500">Coordinate your next match.</p>
            </div>
            <div className="mt-5 flex-1 space-y-3 overflow-y-auto border-y border-zinc-800 py-4">
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
                  <p className="mt-1 text-sm text-zinc-200">{chatMessage.message}</p>
                </article>
              ))}
            </div>
            <form className="mt-4 flex gap-3" onSubmit={handleSendMessage}>
              <input
                className="min-w-0 flex-1 border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-white outline-none focus:border-emerald-400"
                onChange={(event) => setMessageInput(event.target.value || "")}
                placeholder="Message your squad"
                value={messageInput}
              />
              <button className="bg-emerald-400 px-4 py-3 text-sm font-semibold text-zinc-950 disabled:opacity-50" disabled={sending || !messageInput.trim()} type="submit">
                {sending ? "Sending..." : "Send"}
              </button>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
