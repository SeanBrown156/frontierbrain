-- Large files (the tournament pool, long replays) are stored gzip-compressed and base64-encoded.
alter table public.user_files drop constraint user_files_encoding_check;
alter table public.user_files add constraint user_files_encoding_check check (encoding in ('utf8', 'base64', 'gzip'));
alter table public.shared_files drop constraint shared_files_encoding_check;
alter table public.shared_files add constraint shared_files_encoding_check check (encoding in ('utf8', 'base64', 'gzip'));
