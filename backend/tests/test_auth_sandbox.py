import pytest
import asyncio
from services.auth_sandbox import run_unsafe_auth_script, run_unsafe_response_parser

@pytest.mark.asyncio
async def test_run_unsafe_auth_script_success():
    script = """
    const secret = env.API_SECRET;
    return 'Token_' + secret;
    """
    env = {"API_SECRET": "my_super_secret"}
    result = await run_unsafe_auth_script(script, env)
    assert result == "Token_my_super_secret"

@pytest.mark.asyncio
async def test_run_unsafe_auth_script_syntax_error():
    script = """
    const x = ; // syntax error
    """
    result = await run_unsafe_auth_script(script, {})
    assert "ERROR:" in result

@pytest.mark.asyncio
async def test_run_unsafe_response_parser_success():
    body = '{"data": {"token": "abcd-999"}}'
    headers = {"Content-Type": "application/json"}
    script = "vars.set('auth_token', response.body.data.token);"
    
    extracted = await run_unsafe_response_parser(body, headers, script)
    assert extracted == {"auth_token": "abcd-999"}
