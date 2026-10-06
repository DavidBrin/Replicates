-- Risk — persistence schema. Applied idempotently by `pnpm run db:push`
-- (Neon, at deploy time) and by the PGlite adapter on first boot.
-- The online slice (S5) owns this file; keep every statement re-runnable.
--
-- Placeholder from the scaffold: the online slice replaces the body with the
-- players / lobbies / lobby_seats / games / game_players / game_actions /
-- chat_messages tables from SPEC §6.

create table if not exists schema_meta (
  key   text primary key,
  value text not null
);
insert into schema_meta (key, value) values ('scaffold', '1')
  on conflict (key) do nothing;
