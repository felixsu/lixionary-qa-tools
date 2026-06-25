import sys
import os
import types

# Mock pytest module so test imports succeed
pytest_mock = types.ModuleType("pytest")
sys.modules["pytest"] = pytest_mock

# Set python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests.test_ranking import test_rank_locators_anchored_xpath
from tests.test_profiles import test_serialize_doc
from tests.test_executor import test_interpolate_variables, test_extract_jwt_expiry_fallback
from tests.test_generator import test_generate_pom_class_strategies

def run():
    print("Running tests...")
    
    try:
        test_rank_locators_anchored_xpath()
        print("✓ test_rank_locators_anchored_xpath passed")
        
        test_serialize_doc()
        print("✓ test_serialize_doc passed")
        
        test_interpolate_variables()
        print("✓ test_interpolate_variables passed")
        
        test_extract_jwt_expiry_fallback()
        print("✓ test_extract_jwt_expiry_fallback passed")
        
        test_generate_pom_class_strategies()
        print("✓ test_generate_pom_class_strategies passed")
        
        print("\nAll tests passed successfully!")
    except AssertionError as e:
        print(f"\nAssertion Error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\nUnexpected Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    run()
