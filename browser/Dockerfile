FROM mcr.microsoft.com/playwright:v1.45.0-jammy

# Disable interactive configuration prompts during apt-get
ENV DEBIAN_FRONTEND=noninteractive

# Install VNC, noVNC, Xvfb, supervisor, and clean up
RUN apt-get update && apt-get install -y \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

# Copy noVNC files to standard web directory
RUN ln -s /usr/share/novnc/vnc.html /usr/share/novnc/index.html

# Set environment variables for display
ENV DISPLAY=:1
ENV RESOLUTION=1280x720x24

# Create configuration directories
RUN mkdir -p /etc/supervisor/conf.d

# Copy supervisor config, entrypoint, and TCP forwarder script
COPY supervisord.conf /etc/supervisor/supervisord.conf
COPY entrypoint.sh /entrypoint.sh
COPY tcp_forward.py /tcp_forward.py
RUN chmod +x /entrypoint.sh

EXPOSE 8080 9222

ENTRYPOINT ["/entrypoint.sh"]
