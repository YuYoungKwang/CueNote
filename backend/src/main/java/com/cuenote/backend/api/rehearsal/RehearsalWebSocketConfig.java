package com.cuenote.backend.api.rehearsal;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class RehearsalWebSocketConfig implements WebSocketConfigurer {

    private final RehearsalWebSocketHandler handler;

    public RehearsalWebSocketConfig(RehearsalWebSocketHandler handler) {
        this.handler = handler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, "/ws/rehearsal").setAllowedOriginPatterns("*");
    }
}
