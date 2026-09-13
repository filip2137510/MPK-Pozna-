# MPK Poznań

## Uruchomienie na Vercel

1. W Supabase uruchom skrypt z pliku `supabase/schema.sql` w SQL Editor.
2. Utwórz projekt w Vercel i podłącz to repozytorium.
3. W ustawieniach projektu Vercel dodaj zmienne:
	- `SUPABASE_URL` - adres projektu Supabase,
	- `SUPABASE_SERVICE_ROLE_KEY` - klucz `service_role` z Supabase.
4. Wdróż projekt. Strona korzysta z funkcji `/api`, a dane administratorów, sesji i wiadomości są przechowywane w tabeli `app_state`.

Lokalnie można użyć `npx vercel dev` po skonfigurowaniu tych samych zmiennych w `.env.local`.