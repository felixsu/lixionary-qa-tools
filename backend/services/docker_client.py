import socket
import asyncio
import json
import urllib.parse
from typing import Optional, List, Dict, Any

class DockerException(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"Docker API Error {status_code}: {detail}")

class DockerClient:
    def __init__(self, socket_path: str = "/var/run/docker.sock"):
        self.socket_path = socket_path

    async def _request(self, method: str, path: str, body: Optional[Any] = None) -> Any:
        reader, writer = await asyncio.open_unix_connection(self.socket_path)
        try:
            req = f"{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n"
            if body is not None:
                body_bytes = json.dumps(body).encode('utf-8')
                req += f"Content-Type: application/json\r\nContent-Length: {len(body_bytes)}\r\n\r\n"
                writer.write(req.encode('utf-8'))
                writer.write(body_bytes)
            else:
                req += "\r\n"
                writer.write(req.encode('utf-8'))
            await writer.drain()

            # Read HTTP headers
            response = b""
            while b"\r\n\r\n" not in response:
                chunk = await reader.read(4096)
                if not chunk:
                    break
                response += chunk

            if not response:
                return {}

            header_part, body_part = response.split(b"\r\n\r\n", 1)
            header_lines = header_part.split(b"\r\n")
            status_line = header_lines[0].decode('utf-8')
            parts = status_line.split(" ")
            if len(parts) < 2:
                raise DockerException(500, f"Malformed HTTP status line: {status_line}")
            
            status_code = int(parts[1])

            content_length = None
            is_chunked = False
            for line in header_lines[1:]:
                if not line:
                    continue
                h_parts = line.decode('utf-8').split(":", 1)
                if len(h_parts) == 2:
                    name = h_parts[0].strip().lower()
                    val = h_parts[1].strip()
                    if name == "content-length":
                        content_length = int(val)
                    elif name == "transfer-encoding" and val.lower() == "chunked":
                        is_chunked = True

            # Read full body based on headers
            if is_chunked:
                body = b""
                buffer = body_part
                while True:
                    crlf_idx = buffer.find(b"\r\n")
                    if crlf_idx == -1:
                        chunk = await reader.read(4096)
                        if not chunk:
                            break
                        buffer += chunk
                        continue
                    
                    size_hex = buffer[:crlf_idx].strip()
                    if not size_hex:
                        buffer = buffer[crlf_idx + 2:]
                        continue
                    try:
                        chunk_size = int(size_hex, 16)
                    except ValueError:
                        break
                    
                    if chunk_size == 0:
                        break
                    
                    needed_len = crlf_idx + 2 + chunk_size + 2
                    while len(buffer) < needed_len:
                        chunk = await reader.read(4096)
                        if not chunk:
                            break
                        buffer += chunk
                    
                    chunk_data = buffer[crlf_idx + 2 : crlf_idx + 2 + chunk_size]
                    body += chunk_data
                    buffer = buffer[needed_len:]
                body_part = body
            elif content_length is not None:
                while len(body_part) < content_length:
                    chunk = await reader.read(4096)
                    if not chunk:
                        break
                    body_part += chunk

            # Raise exceptions for HTTP errors (>= 300)
            if status_code >= 300:
                err_msg = body_part.decode('utf-8', errors='ignore')
                raise DockerException(status_code, err_msg)

            if not body_part:
                return {}

            return json.loads(body_part.decode('utf-8'))
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass

    async def inspect_container(self, name_or_id: str) -> Dict[str, Any]:
        try:
            return await self._request("GET", f"/containers/{name_or_id}/json")
        except DockerException as e:
            if e.status_code == 404:
                return {}
            raise

    async def list_containers(self, all: bool = True, filters: Optional[Dict[str, List[str]]] = None) -> List[Dict[str, Any]]:
        path = f"/containers/json?all={str(all).lower()}"
        if filters:
            filters_json = json.dumps(filters)
            path += f"&filters={urllib.parse.quote(filters_json)}"
        return await self._request("GET", path)

    async def create_container(self, name: str, config: Dict[str, Any]) -> Dict[str, Any]:
        return await self._request("POST", f"/containers/create?name={name}", body=config)

    async def start_container(self, name_or_id: str) -> None:
        await self._request("POST", f"/containers/{name_or_id}/start")

    async def stop_container(self, name_or_id: str, timeout: int = 10) -> None:
        try:
            await self._request("POST", f"/containers/{name_or_id}/stop?t={timeout}")
        except DockerException as e:
            if e.status_code == 304: # Container already stopped
                return
            raise

    async def remove_container(self, name_or_id: str, force: bool = True, v: bool = True) -> None:
        try:
            await self._request("DELETE", f"/containers/{name_or_id}?force={str(force).lower()}&v={str(v).lower()}")
        except DockerException as e:
            if e.status_code == 404: # Container already removed
                return
            raise

    async def connect_network(self, network_name_or_id: str, container_name_or_id: str) -> None:
        body = {"Container": container_name_or_id}
        try:
            await self._request("POST", f"/networks/{network_name_or_id}/connect", body=body)
        except DockerException as e:
            # Silence warning if container already connected to network
            if "already exists in network" in e.detail or e.status_code == 409:
                return
            raise
