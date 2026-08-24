"""Hermes Discord adapter extension for Kurami run controls.

The bundled adapter remains the implementation of every normal Discord
feature.  This user plugin replaces only the adapter factory and adds one
listener for component IDs owned by the Dev Orchestrator.
"""

from plugins.platforms.discord import adapter as upstream

from .control_handler import install_control_listener, refresh_thread_dashboard
from .settings_handler import install_settings_command


_candidate_base = upstream.DiscordAdapter
_BaseDiscordAdapter = getattr(
    _candidate_base,
    "_kurami_upstream_base",
    _candidate_base,
)


class KuramiDiscordAdapter(_BaseDiscordAdapter):
    """Bundled Hermes Discord adapter plus the Kurami component listener."""

    _kurami_control_layer = True
    _kurami_upstream_base = _BaseDiscordAdapter

    def _settings_owner_authorized(self, interaction) -> bool:
        actor_id = str(getattr(getattr(interaction, "user", None), "id", ""))
        return bool(actor_id) and actor_id in {
            str(value) for value in self._allowed_user_ids
        }

    def _register_slash_commands(self) -> None:
        super()._register_slash_commands()
        if self._client is not None:
            install_settings_command(
                self._client,
                self._settings_owner_authorized,
                refresh_thread_dashboard,
            )

    async def connect(self, *, is_reconnect: bool = False) -> bool:
        connected = await super().connect(is_reconnect=is_reconnect)
        if connected and self._client is not None:
            install_control_listener(
                self._client,
                lambda interaction: upstream._component_check_auth(
                    interaction,
                    self._allowed_user_ids,
                    self._allowed_role_ids,
                ),
            )
        return connected


def register(ctx) -> None:
    """Register the extended adapter through the bundled platform metadata."""

    upstream.DiscordAdapter = KuramiDiscordAdapter
    upstream.register(ctx)


__all__ = ["register"]
