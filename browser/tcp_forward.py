import socket
import threading
import sys

def forward_target_to_client(src, dst):
    """
    Forwards data from Chromium to Client, rewriting local loopback debugger URLs
    to point back to the proxy's network-accessible address, and updates the
    Content-Length header of HTTP responses to prevent truncation.
    """
    try:
        # Read the first chunk (HTTP response headers and initial body)
        data = src.recv(4096)
        if not data:
            return

        # Rewrite debugger websocket URL hosts and update Content-Length
        if b"127.0.0.1:9223" in data:
            body_start = data.find(b"\r\n\r\n")
            if body_start != -1:
                headers = data[:body_start]
                body = data[body_start + 4:]
                
                # Count the difference in body length after replacing
                old_body_len = len(body)
                body = body.replace(b"127.0.0.1:9223", b"vnc-browser:9222")
                len_diff = len(body) - old_body_len
                
                # If length changed, find and update Content-Length header
                if len_diff != 0:
                    header_lines = headers.split(b"\r\n")
                    for i, line in enumerate(header_lines):
                        if line.lower().startswith(b"content-length:"):
                            try:
                                current_len = int(line.split(b":")[1].strip())
                                new_len = current_len + len_diff
                                header_lines[i] = f"Content-Length: {new_len}".encode('utf-8')
                            except Exception:
                                pass
                            break
                    headers = b"\r\n".join(header_lines)
                
                data = headers + b"\r\n\r\n" + body

        dst.sendall(data)

        # Continue raw forwarding for subsequent frames
        while True:
            data = src.recv(4096)
            if not data:
                break
            dst.sendall(data)
    except Exception:
        pass
    finally:
        try:
            src.close()
        except Exception:
            pass
        try:
            dst.close()
        except Exception:
            pass

def forward_client_to_target(src, dst, target_host, target_port):
    """
    Intercepts the first HTTP chunk from the client and rewrites the Host header
    to localhost to bypass Chrome's Host Header validation.
    """
    try:
        # Read the first chunk of data
        data = src.recv(4096)
        if not data:
            return

        # Check if this contains HTTP headers
        if b"Host:" in data:
            lines = data.split(b"\r\n")
            for i, line in enumerate(lines):
                if line.lower().startswith(b"host:"):
                    # Rewrite to look like a localhost/loopback connection
                    lines[i] = f"Host: {target_host}:{target_port}".encode('utf-8')
                    break
            data = b"\r\n".join(lines)

        dst.sendall(data)

        # Resume raw forwarding for subsequent packets (e.g. WebSocket frames)
        while True:
            data = src.recv(4096)
            if not data:
                break
            dst.sendall(data)
    except Exception:
        pass
    finally:
        try:
            src.close()
        except Exception:
            pass
        try:
            dst.close()
        except Exception:
            pass

def handle_client(client_sock, target_host, target_port):
    target_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        target_sock.connect((target_host, target_port))
    except Exception as e:
        print(f"Failed to connect to target {target_host}:{target_port}: {e}")
        client_sock.close()
        return

    # Start bidirectional forwarding threads
    t1 = threading.Thread(target=forward_client_to_target, args=(client_sock, target_sock, target_host, target_port), daemon=True)
    t2 = threading.Thread(target=forward_target_to_client, args=(target_sock, client_sock), daemon=True)
    t1.start()
    t2.start()

def main():
    listen_host = "0.0.0.0"
    listen_port = 9222
    target_host = "127.0.0.1"
    target_port = 9223

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        server.bind((listen_host, listen_port))
        server.listen(100)
        print(f"TCP Host-Rewriting Forwarder listening on {listen_host}:{listen_port} -> {target_host}:{target_port}")
    except Exception as e:
        print(f"Failed to bind listener: {e}")
        sys.exit(1)

    try:
        while True:
            client_sock, addr = server.accept()
            t = threading.Thread(target=handle_client, args=(client_sock, target_host, target_port), daemon=True)
            t.start()
    except KeyboardInterrupt:
        print("Shutting down forwarder...")
    finally:
        server.close()

if __name__ == "__main__":
    main()
