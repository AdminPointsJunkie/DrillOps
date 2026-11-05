# FieldMaps social sign-in

Google is configured in Supabase project dzthwvxrltkltfvubvld. The Google Cloud project is gen-lang-client-0336912368; the separate client is named `FieldMaps account sign-in`. The existing `FieldMaps web imports` client remains separate.

GitHub application: https://github.com/settings/applications/3993966 — created, but client-secret generation requires the owner's GitHub verification. Provider remains disabled until that is completed and its credentials saved in Supabase.

Microsoft: client code supports Supabase's `azure` provider with the required email scope, but administrator configuration is deferred at the user's request. Keep disabled until an Entra registration is ready. Use supported personal/work account types and configure the `xms_edov` email-verification claim as recommended by Supabase before enabling.

## Configuration

Provider credentials belong only in Supabase Auth / Sign In / Providers, never frontend environment variables or Git. Callback for all providers:

`https://dzthwvxrltkltfvubvld.supabase.co/auth/v1/callback`

Manual linking is enabled. Existing email confirmation and anonymous-sign-in settings are unchanged. Exact permitted application return URLs:

- `https://www.drillops.com.au/maps/`
- `https://www.drillops.com.au/maps/?auth_flow=signin`
- `https://www.drillops.com.au/maps/?auth_flow=link`

The UI reads the public Auth settings endpoint and shows only enabled providers (or identities already linked). Normal login uses `signInWithOAuth`. Account Settings uses `linkIdentity` after verifying the currently signed-in user ID; it never substitutes login for linking, moves records, or changes memberships. The callback verifies both original ID and linked provider before reporting success. Failed/cancelled links do not claim success. Unsaved profile/map changes block linking navigation.

Google uses identity/email scopes only; Drive file selection has its own existing consent flow. GitHub requests `read:user user:email`, not repositories. Microsoft requests email only beyond the provider's standard identity scopes.

Users with a different provider email should sign into their original FieldMaps account first and use Account settings. An identity already attached to another FieldMaps user must not be silently merged or have its projects reassigned.

## Verification

`npm test` covers new and existing sign-in paths, same-user linking, switched-user rejection, failed/cancelled callbacks, and disabled-provider gating. Browser checks verify the real Google account chooser and provider scopes. A real user's completed consent/linking session still requires that user's interaction.
