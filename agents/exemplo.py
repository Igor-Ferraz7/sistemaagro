import os
import json
import openai
from dotenv import load_dotenv

load_dotenv()


class AgentFraudCompliance:

    def __init__(self, extracted_data):
        self.data = extracted_data
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("A chave da API da OpenAI não foi encontrada no arquivo .env.")
        self.client = openai.OpenAI(api_key=api_key)

    def analisar(self):
        system_prompt = """
            Você é um analista de risco financeiro sênior, especializado em detectar fraudes em notas fiscais. Sua tarefa é analisar os dados de uma nota e gerar um parecer em JSON com a seguinte estrutura:
            {
              "risk_score": <int, 0-10>,
              "summary": "<string, resumo da análise>",
              "red_flags": [
                {
                  "type": "<string, Ex: 'SOBREPREÇO', 'INCONSISTÊNCIA DE CATEGORIA', 'FORNECEDOR INCOMUM', 'PADRÃO SUSPEITO'>",
                  "description": "<string, descrição do alerta>"
                }
              ]
            }
            Seja rigoroso. Compare o valor pago com uma estimativa de mercado mental. Verifique se os produtos condizem com a categoria e o fornecedor. Procure por padrões suspeitos (valores redondos, etc.).
        """
        user_prompt = f"""
            Realize sua análise de risco com base nos dados da nota fiscal a seguir:
            {json.dumps(self.data, indent=2, ensure_ascii=False)}
        """
        try:
            response = self.client.chat.completions.create(
                model="gpt-5-mini",
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ]
            )
            return json.loads(response.choices[0].message.content)
        except Exception as e:
            raise Exception(f"Erro no Agente de Análise de Risco (OpenAI): {e}")