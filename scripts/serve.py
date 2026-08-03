#!/usr/bin/env python3
"""
Servidor local para o Leitor DICOM.

O visualizador roda inteiramente no navegador, mas precisa ser servido por HTTP
(módulos ES e fetch não funcionam a partir de file://). Nenhum dado sai da
máquina: este servidor só entrega os arquivos da própria pasta do projeto.

    python3 scripts/serve.py            # http://localhost:8000
    python3 scripts/serve.py 9000
    python3 scripts/serve.py --rede     # também acessível pela rede local,
                                        # para abrir no celular
"""
import functools
import http.server
import socket
import socketserver
import sys
import webbrowser
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".dcm": "application/dicom",
        ".json": "application/json",
    }

    def end_headers(self):
        # o volume é remontado a cada carga; evita servir fatias obsoletas
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, formato, *args):
        if "304" in str(args) or ".dcm" in str(args):
            return
        super().log_message(formato, *args)


def ip_local():
    """IP desta máquina na rede local (sem enviar nada — só consulta a rota)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 1))     # endereço reservado para documentação
        return s.getsockname()[0]
    except Exception:
        return None
    finally:
        s.close()


def main():
    argumentos = [a for a in sys.argv[1:] if not a.startswith("-")]
    rede = "--rede" in sys.argv
    porta = int(argumentos[0]) if argumentos else 8000

    handler = functools.partial(Handler, directory=str(RAIZ))
    socketserver.TCPServer.allow_reuse_address = True
    endereco = "0.0.0.0" if rede else "127.0.0.1"

    with socketserver.ThreadingTCPServer((endereco, porta), handler) as httpd:
        url = f"http://localhost:{porta}/"
        print(f"Leitor DICOM em {url}   (Ctrl+C para encerrar)")
        if rede:
            ip = ip_local()
            if ip:
                print(f"No celular, na mesma rede: http://{ip}:{porta}/")
            print("Atenção: com --rede qualquer aparelho da rede local alcança "
                  "esta pasta.")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nencerrado.")


if __name__ == "__main__":
    main()
