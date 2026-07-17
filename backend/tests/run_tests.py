import sys
import os
import types

# Mock pytest module so test imports succeed
pytest_mock = types.ModuleType("pytest")
sys.modules["pytest"] = pytest_mock

# Set python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio
from tests.test_ranking import test_rank_locators_anchored_xpath
from tests.test_profiles import test_serialize_doc
from tests.test_executor import test_interpolate_variables, test_resolve_input_bindings, test_interpolate_variables_dynamic_tokens, test_interpolate_variables_date_math, test_resolve_request, test_extract_jwt_expiry_fallback, test_get_valid_auth_token_caching
from tests.test_generator import test_generate_pom_class_strategies, test_build_pom_method_code_with_url
from tests.test_workspace import test_sanitize_filename
from tests.test_admin import test_serialize_user, test_serialize_collection
from tests.test_flows import test_serialize_flow_doc

def run():
    print("Running tests...")
    
    try:
        test_rank_locators_anchored_xpath()
        print("✓ test_rank_locators_anchored_xpath passed")
        
        test_serialize_doc()
        print("✓ test_serialize_doc passed")
        
        test_interpolate_variables()
        print("✓ test_interpolate_variables passed")

        test_resolve_input_bindings()
        print("✓ test_resolve_input_bindings passed")

        test_interpolate_variables_dynamic_tokens()
        print("✓ test_interpolate_variables_dynamic_tokens passed")

        test_interpolate_variables_date_math()
        print("✓ test_interpolate_variables_date_math passed")

        asyncio.run(test_resolve_request())
        print("✓ test_resolve_request passed")

        test_extract_jwt_expiry_fallback()
        print("✓ test_extract_jwt_expiry_fallback passed")
        
        asyncio.run(test_get_valid_auth_token_caching())
        print("✓ test_get_valid_auth_token_caching passed")
        
        test_sanitize_filename()
        print("✓ test_sanitize_filename passed")
        
        test_generate_pom_class_strategies()
        print("✓ test_generate_pom_class_strategies passed")
        
        test_build_pom_method_code_with_url()
        print("✓ test_build_pom_method_code_with_url passed")
        
        test_serialize_user()
        print("✓ test_serialize_user passed")
        
        test_serialize_collection()
        print("✓ test_serialize_collection passed")

        test_serialize_flow_doc()
        print("✓ test_serialize_flow_doc passed")
        
        print("\nAll tests passed successfully!")
    except AssertionError as e:
        print(f"\nAssertion Error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\nUnexpected Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    run()
