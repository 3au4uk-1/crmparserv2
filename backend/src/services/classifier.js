import axios from 'axios';
import { config } from '../config.js';

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeMatchText(text) {
  return text.toLowerCase().replace(/ё/g, 'е');
}

/** Match keyword only at a word boundary (not inside another word like «плёнка» in «цыплёнка»). */
export function keywordMatchesItemName(itemName, keyword) {
  const text = normalizeMatchText(itemName);
  const kw = escapeRegExp(normalizeMatchText(keyword));
  if (!kw) return false;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${kw}`, 'iu');
  return re.test(text);
}

export function classifyByKeywords(items, keywords) {
  return items.map(item => {
    const matched = keywords.some((kw) => keywordMatchesItemName(item.name, kw));
    return {
      ...item,
      classification: matched ? 'keyword_match' : 'unclassified',
      classification_confidence: matched ? 1.0 : null,
    };
  });
}

export async function classifyByLlm(items, prompt) {
  if (!config.llmApiUrl || !config.llmApiKey) {
    return items.map(item => ({ ...item }));
  }

  const itemNames = items.map(i => i.name).join('\n- ');
  const userMessage = `Определи, какие из этих позиций относятся к брендингу:\n- ${itemNames}`;

  try {
    const response = await axios.post(
      config.llmApiUrl,
      {
        model: config.llmModel,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      },
      {
        headers: {
          'Authorization': `Bearer ${config.llmApiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const content = response.data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);

    return items.map(item => {
      const llmItem = parsed.items?.find(
        li => li.name.toLowerCase() === item.name.toLowerCase()
      );
      if (!llmItem) return item;
      return {
        ...item,
        classification: llmItem.is_branding ? 'llm_confirmed' : 'llm_rejected',
        classification_confidence: llmItem.confidence ?? null,
      };
    });
  } catch (err) {
    console.error('LLM classification failed:', err.message);
    return items.map(item => ({ ...item }));
  }
}

export async function classifyItems(items, keywords, llmPrompt) {
  const afterKeywords = classifyByKeywords(items, keywords);
  const unclassified = afterKeywords.filter(i => i.classification === 'unclassified');

  if (unclassified.length === 0 || !config.llmApiUrl) {
    return afterKeywords;
  }

  const llmResults = await classifyByLlm(unclassified, llmPrompt);

  return afterKeywords.map(item => {
    if (item.classification !== 'unclassified') return item;
    const llmResult = llmResults.find(
      li => li.name === item.name
    );
    return llmResult || item;
  });
}
