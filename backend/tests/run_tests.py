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
from tests.test_executor import test_interpolate_variables, test_resolve_input_bindings, test_interpolate_variables_dynamic_tokens, test_interpolate_variables_date_math, test_resolve_request, test_resolve_request_with_interceptor_hmac_header, test_extract_jwt_expiry_fallback, test_get_valid_auth_token_caching
from tests.test_generator import test_generate_pom_class_strategies, test_build_pom_method_code_with_url, test_record_interaction
from tests.test_workspace import test_sanitize_filename, test_reset_workspace_file
from tests.test_admin import test_serialize_user, test_serialize_collection
from tests.test_flows import test_serialize_flow_doc
from tests.test_auth import test_expired_token_reports_expiry_not_bad_signature, test_refresh_token_rotates_and_rejects_replay, test_refresh_token_rejected_when_expired_or_user_disabled, test_revoke_is_idempotent
from tests.test_user_guides import test_serialize_guide_hierarchy_fields, test_normalize_slug, test_compute_depth_and_height, test_is_descendant_cycle_detection, test_move_depth_rule
from tests.test_local_ai import test_validate_assistant_response_shapes, test_normalize_messages_merges_roles

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

        asyncio.run(test_resolve_request_with_interceptor_hmac_header())
        print("✓ test_resolve_request_with_interceptor_hmac_header passed")

        test_extract_jwt_expiry_fallback()
        print("✓ test_extract_jwt_expiry_fallback passed")
        
        asyncio.run(test_get_valid_auth_token_caching())
        print("✓ test_get_valid_auth_token_caching passed")
        
        test_sanitize_filename()
        print("✓ test_sanitize_filename passed")

        asyncio.run(test_reset_workspace_file())
        print("✓ test_reset_workspace_file passed")
        
        test_generate_pom_class_strategies()
        print("✓ test_generate_pom_class_strategies passed")
        
        test_build_pom_method_code_with_url()
        print("✓ test_build_pom_method_code_with_url passed")
        
        asyncio.run(test_record_interaction())
        print("✓ test_record_interaction passed")
        
        test_serialize_user()
        print("✓ test_serialize_user passed")
        
        test_serialize_collection()
        print("✓ test_serialize_collection passed")

        test_serialize_flow_doc()
        print("✓ test_serialize_flow_doc passed")

        asyncio.run(test_expired_token_reports_expiry_not_bad_signature())
        print("✓ test_expired_token_reports_expiry_not_bad_signature passed")

        asyncio.run(test_refresh_token_rotates_and_rejects_replay())
        print("✓ test_refresh_token_rotates_and_rejects_replay passed")

        asyncio.run(test_refresh_token_rejected_when_expired_or_user_disabled())
        print("✓ test_refresh_token_rejected_when_expired_or_user_disabled passed")

        asyncio.run(test_revoke_is_idempotent())
        print("✓ test_revoke_is_idempotent passed")

        test_serialize_guide_hierarchy_fields()
        print("✓ test_serialize_guide_hierarchy_fields passed")

        test_normalize_slug()
        print("✓ test_normalize_slug passed")

        test_compute_depth_and_height()
        print("✓ test_compute_depth_and_height passed")

        test_is_descendant_cycle_detection()
        print("✓ test_is_descendant_cycle_detection passed")

        test_move_depth_rule()
        print("✓ test_move_depth_rule passed")

        test_validate_assistant_response_shapes()
        print("✓ test_validate_assistant_response_shapes passed")

        test_normalize_messages_merges_roles()
        print("✓ test_normalize_messages_merges_roles passed")

        print("\nAll tests passed successfully!")
    except AssertionError as e:
        print(f"\nAssertion Error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\nUnexpected Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    run()
