#include <iostream>
#include <map>
#include <optional>
#include <string>
#include <vector>

enum class Size { Small = 0, Medium = 1, Large = 2 };

struct Spot {
  int floor;
  int number;
  Size size;
  bool taken = false;
};

class ParkingLot {
 public:
  explicit ParkingLot(std::vector<Spot> spots) : spots_(std::move(spots)) {}

  // A vehicle fits its own size or any larger spot.
  std::optional<int> enter(const std::string& plate, Size size) {
    for (auto& spot : spots_) {
      if (spot.taken || spot.size < size) continue;
      spot.taken = true;
      parked_[plate] = &spot;
      return spot.number;
    }
    return std::nullopt;
  }

  bool exit(const std::string& plate) {
    auto it = parked_.find(plate);
    if (it == parked_.end()) return false;
    it->second->taken = false;
    parked_.erase(it);
    return true;
  }

 private:
  std::vector<Spot> spots_;
  std::map<std::string, Spot*> parked_;
};

int main() {
  ParkingLot lot({{0, 1, Size::Small}, {0, 2, Size::Large}});
  auto car = lot.enter("CAR-1", Size::Medium);
  std::cout << "car spot: " << (car ? std::to_string(*car) : "none") << "\n";
  std::cout << "second car: " << (lot.enter("CAR-2", Size::Medium) ? "parked" : "rejected") << "\n";
  std::cout << "exit: " << (lot.exit("CAR-1") ? "ok" : "unknown") << "\n";
  return 0;
}
