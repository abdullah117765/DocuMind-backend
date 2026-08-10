from app.config.settings import get_settings
from app.models.rag import RagSearchResult


class LlmService:
    @property
    def is_available(self) -> bool:
        return bool(get_settings().GEMINI_API_KEY.strip())

    def answer(self, query: str, results: list[RagSearchResult]) -> tuple[str, str | None, bool]:
        settings = get_settings()

        if not self.is_available:
            return (
                "AI answer generation is not configured yet. Search results are available below.",
                None,
                False,
            )

        try:
            from google import genai

            client = genai.Client(api_key=settings.GEMINI_API_KEY)
            prompt = self._build_prompt(query, results)
            response = client.models.generate_content(
                model=settings.GEMINI_MODEL,
                contents=prompt,
            )

            return (
                response.text or "No answer was generated.",
                settings.GEMINI_MODEL,
                True,
            )
        except Exception:
            return (
                "AI answer generation is temporarily unavailable. Search results are available below.",
                settings.GEMINI_MODEL,
                False,
            )

    def _build_prompt(self, query: str, results: list[RagSearchResult]) -> str:
        excerpts = []

        for index, result in enumerate(results, start=1):
            excerpts.append(
                "\n".join(
                    [
                        f'Source [{index}] "{result.document_name}" '
                        f"(version {result.version_number}, chunk {result.chunk_index + 1}):",
                        result.text,
                    ]
                )
            )

        return "\n\n".join(
            [
                "You are Documind AI, a careful assistant inside a production document intelligence SaaS platform.",
                "Your job is to answer the user's question using ONLY the document excerpts provided below.",
                "",
                "Answer rules:",
                "- Start with a direct answer in 1-2 sentences.",
                "- Return clean Markdown.",
                "- Then add concise bullet points only if they make the answer clearer.",
                "- Put every bullet on its own line starting with '- '. Never write bullets inline inside a paragraph.",
                "- Leave a blank line before and after bullet lists.",
                "- Use bold only for short labels inside bullets, for example '- **Requirement:** ...'.",
                "- Cite evidence naturally using source numbers like [1] or [2].",
                "- Do not mention chunk numbers unless the user asks for technical trace details.",
                "- If excerpts disagree, explain the conflict and cite both sources.",
                "- If the excerpts are weak or incomplete, say exactly what is missing.",
                "- If the answer is not present in the excerpts, say: \"I could not find this in the selected documents.\"",
                "- Do not use outside knowledge. Do not guess. Do not invent names, dates, policies, amounts, or steps.",
                "- Keep the tone professional, clean, and easy for a business user to understand.",
                "- Avoid filler phrases such as \"Based on the provided documents\" unless needed.",
                "- If the user asks for a summary, produce a short executive summary with key points.",
                "- If the user asks for a process/policy, format it as steps or requirements.",
                "- If the user asks a yes/no question, answer yes/no first, then explain.",
                "",
                "Document excerpts:",
                "\n\n".join(excerpts) or "No excerpts were found.",
                "",
                f"User question: {query}",
                "",
                "Final answer:",
            ]
        )
