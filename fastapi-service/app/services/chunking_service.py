from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.config.settings import get_settings


class ChunkingService:
    def __init__(self) -> None:
        settings = get_settings()
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=settings.CHUNK_SIZE,
            chunk_overlap=settings.CHUNK_OVERLAP,
            separators=["\n\n", "\n", ". ", " ", ""],
            length_function=len,
        )

    def chunk(self, text: str) -> list[dict[str, int | str]]:
        if not text.strip():
            return []

        chunks = self.splitter.split_text(text)
        output = []
        cursor = 0

        for index, chunk in enumerate(chunks):
            start = text.find(chunk, cursor)
            if start < 0:
                start = cursor
            end = start + len(chunk)
            cursor = max(start, end - 1)

            output.append(
                {
                    "text": chunk,
                    "index": index,
                    "char_start": start,
                    "char_end": end,
                }
            )

        return output
