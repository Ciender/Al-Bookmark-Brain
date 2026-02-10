import {
    buildGeminiGenerateContentUrl,
    buildOpenAIChatCompletionsUrl,
    normalizeOpenAIBaseUrl,
} from './endpoints';

function assertEqual(actual: string, expected: string, message: string) {
    if (actual !== expected) {
        throw new Error(`${message}\nexpected: ${expected}\nactual: ${actual}`);
    }
}

function runTests() {
    assertEqual(
        normalizeOpenAIBaseUrl('https://api.openai.com/v1/chat/completions'),
        'https://api.openai.com/v1',
        'normalizeOpenAIBaseUrl should strip legacy chat/completions suffix'
    );

    assertEqual(
        buildOpenAIChatCompletionsUrl('https://api.openai.com/v1/chat/completions'),
        'https://api.openai.com/v1/chat/completions',
        'buildOpenAIChatCompletionsUrl should avoid double path'
    );

    assertEqual(
        buildGeminiGenerateContentUrl('gemini-pro', 'https://generativelanguage.googleapis.com/v1beta'),
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
        'buildGeminiGenerateContentUrl should assemble model endpoint from base URL'
    );

    console.log('AI endpoint assembly tests passed');
}

runTests();

