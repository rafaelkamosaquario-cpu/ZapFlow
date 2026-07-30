import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * Geração de PDF de relatórios (Camada 6, Fase D). Layout simples e
 * utilitário — texto corrido, sem gráficos. `pdf-lib` não tem dependências
 * nativas, roda igual em qualquer ambiente Node (inclusive o do Railway).
 */

export interface LinhaChaveValor {
  chave: string;
  valor: string;
}

export interface DocumentoRelatorio {
  titulo: string;
  geradoEm: Date;
  nomeUsuario?: string;
  nomeEmpresa?: string;
  periodo?: string;
  pedidoUsuario?: string;
  resumo?: string;
  linhas: LinhaChaveValor[];
  observacoes?: string;
}

const MARGEM = 50;
const LARGURA_PAGINA = 595.28; // A4 pt
const ALTURA_PAGINA = 841.89;
const LARGURA_UTIL = LARGURA_PAGINA - MARGEM * 2;

function quebrarLinha(texto: string, maxCaracteres: number): string[] {
  const palavras = texto.split(/\s+/);
  const linhas: string[] = [];
  let atual = "";

  for (const palavra of palavras) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (tentativa.length > maxCaracteres) {
      if (atual) linhas.push(atual);
      atual = palavra;
    } else {
      atual = tentativa;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

export async function gerarPdfRelatorio(doc: DocumentoRelatorio): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  let page = pdf.addPage([LARGURA_PAGINA, ALTURA_PAGINA]);
  const fonteRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fonteNegrito = await pdf.embedFont(StandardFonts.HelveticaBold);

  let cursorY = ALTURA_PAGINA - MARGEM;

  function novaPaginaSeNecessario(alturaLinha: number) {
    if (cursorY - alturaLinha < MARGEM) {
      page = pdf.addPage([LARGURA_PAGINA, ALTURA_PAGINA]);
      cursorY = ALTURA_PAGINA - MARGEM;
    }
  }

  function escreverLinha(texto: string, opcoes: { negrito?: boolean; tamanho?: number; cor?: [number, number, number] } = {}) {
    const tamanho = opcoes.tamanho ?? 11;
    const fonte = opcoes.negrito ? fonteNegrito : fonteRegular;
    const maxCaracteres = Math.floor(LARGURA_UTIL / (tamanho * 0.5));
    const linhas = quebrarLinha(texto, Math.max(maxCaracteres, 20));

    for (const linha of linhas) {
      novaPaginaSeNecessario(tamanho + 4);
      page.drawText(linha, {
        x: MARGEM,
        y: cursorY,
        size: tamanho,
        font: fonte,
        color: opcoes.cor ? rgb(...opcoes.cor) : rgb(0.1, 0.1, 0.1),
      });
      cursorY -= tamanho + 6;
    }
  }

  function espaco(altura = 10) {
    cursorY -= altura;
  }

  escreverLinha(doc.titulo, { negrito: true, tamanho: 18 });
  espaco(4);
  escreverLinha(`Gerado em ${doc.geradoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`, {
    tamanho: 9,
    cor: [0.4, 0.4, 0.4],
  });
  espaco(14);

  if (doc.nomeUsuario) escreverLinha(`Cliente: ${doc.nomeUsuario}`);
  if (doc.nomeEmpresa) escreverLinha(`Empresa: ${doc.nomeEmpresa}`);
  if (doc.periodo) escreverLinha(`Período analisado: ${doc.periodo}`);
  if (doc.pedidoUsuario) escreverLinha(`Pedido: ${doc.pedidoUsuario}`);
  espaco(10);

  if (doc.resumo) {
    escreverLinha("Resumo", { negrito: true, tamanho: 13 });
    escreverLinha(doc.resumo);
    espaco(10);
  }

  if (doc.linhas.length > 0) {
    escreverLinha("Detalhes", { negrito: true, tamanho: 13 });
    for (const { chave, valor } of doc.linhas) {
      escreverLinha(`${chave}: ${valor}`);
    }
    espaco(10);
  }

  if (doc.observacoes) {
    escreverLinha("Observações", { negrito: true, tamanho: 13 });
    escreverLinha(doc.observacoes);
    espaco(10);
  }

  espaco(20);
  escreverLinha("Frota IA — especialista virtual em transporte e gestão de frotas.", {
    tamanho: 8,
    cor: [0.5, 0.5, 0.5],
  });

  return pdf.save();
}
